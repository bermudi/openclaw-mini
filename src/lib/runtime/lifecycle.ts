import cron, { type ScheduledTask } from 'node-cron';
import { db } from '@/lib/db';
import { getRuntimeConfig } from '@/lib/config/runtime';
import { initialize } from '@/lib/init';
import { ensureInternalAuthConfigured } from '@/lib/internal-auth';
import { initializeAdapters, getRegisteredAdapters } from '@/lib/adapters';
import { agentExecutor } from '@/lib/services/agent-executor';
import { eventBus, registerEventBusBroadcaster } from '@/lib/services/event-bus';
import { triggerService } from '@/lib/services/trigger-service';
import { runRuntimeMaintenance } from '@/lib/runtime/maintenance';
import { RuntimeRealtimeServer, type RuntimeReadinessSnapshot, type RuntimeReadinessState } from '@/lib/runtime/realtime-server';
import type { ChannelAdapter } from '@/lib/types';

export interface RuntimeStartResult {
  ready: boolean;
  state: RuntimeReadinessState;
}

export class RuntimeLifecycleManager {
  private state: RuntimeReadinessState = 'stopped';
  private readinessError: string | null = null;
  private startPromise: Promise<RuntimeStartResult> | null = null;
  private stopPromise: Promise<void> | null = null;
  private realtimeServer = new RuntimeRealtimeServer({
    readinessProvider: () => this.getReadinessSnapshot(),
  });
  private readonly dispatchingAgents = new Set<string>();
  private readonly intervalHandles = new Set<NodeJS.Timeout>();
  private readonly unsubscribers = new Set<() => void>();
  private readonly adapterWasConnected = new Map<string, boolean>();
  private cleanupTask: ScheduledTask | null = null;
  private runningTriggerSweep = false;
  private runningTaskReconcile = false;
  private runningDeliverySweep = false;
  private runningRecoverySweep = false;
  private runningAdapterCheck = false;

  start(): Promise<RuntimeStartResult> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<RuntimeStartResult> {
    this.state = 'booting';
    this.readinessError = null;

    await this.realtimeServer.start();

    try {
      ensureInternalAuthConfigured('runtime');
      const initResult = await initialize();
      if (!initResult.success) {
        throw new Error(initResult.hardFailures.map((failure) => failure.error).join('; '));
      }

      initializeAdapters();
      await this.startAdapters(getRegisteredAdapters());
      registerEventBusBroadcaster(this.realtimeServer);
      this.installRuntimeListeners();
      await this.runStartupRecovery();
      await this.reconcilePendingTasks();
      await this.processDueTriggers();
      await this.runDeliverySweep();
      this.startLoops();
      this.state = 'ready';

      return {
        ready: true,
        state: this.state,
      };
    } catch (error) {
      this.state = 'failed';
      this.readinessError = error instanceof Error ? error.message : String(error);
      registerEventBusBroadcaster(null);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    this.state = 'stopping';
    registerEventBusBroadcaster(null);

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.clear();

    for (const handle of this.intervalHandles) {
      clearInterval(handle);
    }
    this.intervalHandles.clear();

    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask.destroy();
      this.cleanupTask = null;
    }

    await this.stopAdapters(getRegisteredAdapters());
    await this.realtimeServer.stop();
    await db.$disconnect();

    this.dispatchingAgents.clear();
    this.adapterWasConnected.clear();
    this.state = 'stopped';
    this.readinessError = null;
    this.startPromise = null;
    this.stopPromise = null;
  }

  getReadinessSnapshot(): RuntimeReadinessSnapshot {
    return {
      state: this.state,
      error: this.readinessError,
    };
  }

  getRealtimePort(): number {
    return this.realtimeServer.getPort();
  }

  async runMaintenance(input?: Parameters<typeof runRuntimeMaintenance>[0]) {
    return runRuntimeMaintenance(input);
  }

  scheduleAgentDispatch(agentId: string): void {
    queueMicrotask(() => {
      void this.dispatchAgent(agentId);
    });
  }

  private installRuntimeListeners(): void {
    this.unsubscribers.add(eventBus.on('task:created', ({ agentId }) => {
      this.scheduleAgentDispatch(agentId);
    }));

    this.unsubscribers.add(eventBus.on('task:completed', ({ agentId }) => {
      this.scheduleAgentDispatch(agentId);
    }));

    this.unsubscribers.add(eventBus.on('task:failed', ({ agentId }) => {
      this.scheduleAgentDispatch(agentId);
    }));
  }

  private startLoops(): void {
    const runtimeConfig = getRuntimeConfig();

    this.intervalHandles.add(setInterval(() => {
      void this.reconcilePendingTasks();
    }, runtimeConfig.performance.pollInterval));

    this.intervalHandles.add(setInterval(() => {
      void this.processDueTriggers();
    }, runtimeConfig.performance.heartbeatInterval));

    this.intervalHandles.add(setInterval(() => {
      void this.runDeliverySweep();
    }, 5000));

    this.intervalHandles.add(setInterval(() => {
      void this.runRecoverySweep();
    }, 30000));

    this.intervalHandles.add(setInterval(() => {
      void this.checkAdapterHealth();
    }, 30000));

    this.cleanupTask = cron.schedule('0 3 * * *', () => {
      void this.runMaintenance({
        processDeliveries: false,
        sweepOrphanedSubagents: false,
        sweepStaleBusyAgents: false,
        cleanupOldTasks: true,
        cleanupHistoryArchives: true,
        decayMemoryConfidence: true,
      });
    });
  }

  private async runStartupRecovery(): Promise<void> {
    await this.runMaintenance({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: true,
      cleanupOldTasks: false,
      cleanupHistoryArchives: false,
      decayMemoryConfidence: false,
    });
  }

  private async dispatchAgent(agentId: string): Promise<void> {
    if (this.state !== 'ready' || this.dispatchingAgents.has(agentId)) {
      return;
    }

    this.dispatchingAgents.add(agentId);
    try {
      while (this.state === 'ready') {
        const result = await agentExecutor.processNextTask(agentId);
        if (!result) {
          break;
        }

        if (!result.success) {
          break;
        }
      }
    } catch (error) {
      console.error(`[Runtime] Agent dispatch failed for ${agentId}:`, error);
    } finally {
      this.dispatchingAgents.delete(agentId);
    }
  }

  private async reconcilePendingTasks(): Promise<void> {
    if (this.runningTaskReconcile || this.state !== 'ready') {
      return;
    }

    this.runningTaskReconcile = true;
    try {
      const agents = await db.agent.findMany({
        where: {
          status: 'idle',
          tasks: {
            some: { status: 'pending' },
          },
        },
        select: { id: true },
      });

      await Promise.all(agents.map((agent) => this.dispatchAgent(agent.id)));
    } catch (error) {
      console.error('[Runtime] Pending task reconciliation failed:', error);
    } finally {
      this.runningTaskReconcile = false;
    }
  }

  private async processDueTriggers(): Promise<void> {
    if (this.runningTriggerSweep || this.state !== 'ready') {
      return;
    }

    this.runningTriggerSweep = true;
    try {
      const dueTriggers = await triggerService.getDueTriggers();
      const referenceTime = new Date();

      for (const trigger of dueTriggers) {
        try {
          const result = await triggerService.fireTimeBasedTrigger(trigger.id, {
            mode: 'scheduled',
            referenceTime,
          });

          await eventBus.emit('trigger:fired', {
            triggerId: result.trigger.id,
            agentId: result.trigger.agentId,
            triggerType: result.trigger.type,
            taskId: result.task.id,
          });
        } catch (error) {
          console.error(`[Runtime] Trigger fire failed for ${trigger.id}:`, error);
        }
      }
    } catch (error) {
      console.error('[Runtime] Trigger sweep failed:', error);
    } finally {
      this.runningTriggerSweep = false;
    }
  }

  private async runDeliverySweep(): Promise<void> {
    if (this.runningDeliverySweep || this.state !== 'ready') {
      return;
    }

    this.runningDeliverySweep = true;
    try {
      await this.runMaintenance({
        processDeliveries: true,
        sweepOrphanedSubagents: false,
        sweepStaleBusyAgents: false,
        cleanupOldTasks: false,
        cleanupHistoryArchives: false,
        decayMemoryConfidence: false,
      });
    } catch (error) {
      console.error('[Runtime] Delivery sweep failed:', error);
    } finally {
      this.runningDeliverySweep = false;
    }
  }

  private async runRecoverySweep(): Promise<void> {
    if (this.runningRecoverySweep || this.state !== 'ready') {
      return;
    }

    this.runningRecoverySweep = true;
    try {
      await this.runMaintenance({
        processDeliveries: false,
        sweepOrphanedSubagents: true,
        sweepStaleBusyAgents: true,
        cleanupOldTasks: false,
        cleanupHistoryArchives: false,
        decayMemoryConfidence: false,
      });
    } catch (error) {
      console.error('[Runtime] Recovery sweep failed:', error);
    } finally {
      this.runningRecoverySweep = false;
    }
  }

  private async startAdapters(adapters: ChannelAdapter[]): Promise<void> {
    for (const adapter of adapters) {
      this.adapterWasConnected.set(adapter.channel, adapter.isConnected?.() ?? false);
      if (typeof adapter.start !== 'function') {
        continue;
      }

      try {
        await adapter.start();
      } catch (error) {
        console.error(`[Runtime] Adapter start failed (${adapter.channel}):`, error);
      }

      this.adapterWasConnected.set(adapter.channel, adapter.isConnected?.() ?? false);
    }
  }

  private async stopAdapters(adapters: ChannelAdapter[]): Promise<void> {
    await Promise.all(adapters
      .filter((adapter) => typeof adapter.stop === 'function')
      .map(async (adapter) => {
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
        try {
          await Promise.race([adapter.stop!(), timeout]);
        } catch (error) {
          console.error(`[Runtime] Adapter stop failed (${adapter.channel}):`, error);
        }
      }));
  }

  private async checkAdapterHealth(): Promise<void> {
    if (this.runningAdapterCheck || this.state !== 'ready') {
      return;
    }

    this.runningAdapterCheck = true;
    try {
      for (const adapter of getRegisteredAdapters()) {
        if (typeof adapter.isConnected !== 'function') {
          continue;
        }

        const nowConnected = adapter.isConnected();
        const wasConnected = this.adapterWasConnected.get(adapter.channel) ?? false;

        if (!nowConnected && wasConnected && typeof adapter.start === 'function') {
          try {
            await adapter.start();
          } catch (error) {
            console.error(`[Runtime] Adapter recovery failed (${adapter.channel}):`, error);
          }
        }

        this.adapterWasConnected.set(adapter.channel, adapter.isConnected());
      }
    } finally {
      this.runningAdapterCheck = false;
    }
  }
}

export const runtimeLifecycle = new RuntimeLifecycleManager();
