// OpenClaw Scheduler Service
// Background worker for task processing and trigger management

import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { initializeAdapters, getRegisteredAdapters } from '../../src/lib/adapters';
import { getRuntimeConfig, getPrismaLogConfig } from '../../src/lib/config/runtime';
import { buildInternalAuthHeaders, ensureInternalAuthConfigured } from '../../src/lib/internal-auth';
import { createConfiguredPrismaClient } from '../../src/lib/prisma-client';

let prisma: PrismaClient | null = null;
let prismaReady: Promise<void> | null = null;
let prismaInitPromise: Promise<PrismaClient> | null = null;

const APP_BASE_URL = process.env.OPENCLAW_APP_URL || 'http://localhost:3000';

// Status tracking
let isRunning = false;
let tasksProcessed = 0;
let triggersFired = 0;
let deliveriesSent = 0;
let deliveriesFailed = 0;

console.log('[Scheduler] OpenClaw Scheduler Service starting...');

async function getSchedulerPrisma(): Promise<PrismaClient> {
  if (prisma) {
    return prisma;
  }

  if (!prismaInitPromise) {
    prismaInitPromise = (async () => {
      const configured = createConfiguredPrismaClient({
        log: getPrismaLogConfig(),
        scope: 'scheduler',
      });

      prismaReady = configured.ready;
      await prismaReady;
      return configured.client;
    })();
  }

  try {
    prisma = await prismaInitPromise;
    return prisma;
  } catch (error) {
    prisma = null;
    prismaReady = null;
    prismaInitPromise = null;
    throw error;
  } finally {
    if (prisma) {
      prismaInitPromise = null;
    }
  }
}

// ============================================
// Task Processor - Polls and executes pending tasks
// ============================================
async function processPendingTasks() {
  try {
    const prisma = await getSchedulerPrisma();
    // Find agents that are idle and have pending tasks
    const agentsWithTasks = await prisma.agent.findMany({
      where: {
        status: 'idle',
        tasks: {
          some: { status: 'pending' }
        }
      },
      include: {
        tasks: {
          where: { status: 'pending' },
          orderBy: [
            { priority: 'asc' },
            { createdAt: 'asc' }
          ],
          take: 1
        }
      }
    });

    for (const agent of agentsWithTasks) {
      const task = agent.tasks[0];
      if (!task) continue;

      console.log(`[Scheduler] Processing task ${task.id} for agent ${agent.name}`);

      // Execute the task via API call to main app
      try {
        const result = await executeTaskViaApi(task.id);

        if (result.success) {
          tasksProcessed++;
          console.log(`[Scheduler] Task ${task.id} completed successfully`);
        } else {
          console.error(`[Scheduler] Task ${task.id} failed:`, result.error);
        }
      } catch (error) {
        console.error(`[Scheduler] Failed to execute task ${task.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error processing tasks:', error);
  }
}

async function executeTaskViaApi(taskId: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${APP_BASE_URL}/api/tasks/${taskId}/execute`, {
    method: 'POST',
    headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
  });

  return response.json();
}

async function createTaskViaApi(input: {
  agentId: string;
  type: 'heartbeat' | 'cron';
  priority: number;
  payload: Record<string, unknown>;
  source: string;
}): Promise<{ success: boolean; data?: { id: string }; error?: string }> {
  const response = await fetch(`${APP_BASE_URL}/api/tasks`, {
    method: 'POST',
    headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });

  const body = await response.json() as { success?: boolean; data?: { id: string }; error?: string };

  if (!response.ok || !body.success || !body.data?.id) {
    return { success: false, error: body.error ?? `Task creation failed with status ${response.status}` };
  }

  return { success: true, data: body.data };
}

async function fireTriggerViaApi(input: {
  triggerId: string;
  referenceTime?: string;
}): Promise<{ success: boolean; data?: { trigger: unknown; task: unknown }; error?: string }> {
  const response = await fetch(`${APP_BASE_URL}/api/internal/triggers/${input.triggerId}/fire`, {
    method: 'POST',
    headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      ...(input.referenceTime && { referenceTime: input.referenceTime }),
    }),
  });

  const body = await response.json() as { success?: boolean; data?: { trigger: unknown; task: unknown }; error?: string };

  if (!response.ok || !body.success || !body.data) {
    return { success: false, error: body.error ?? `Trigger fire failed with status ${response.status}` };
  }

  return { success: true, data: body.data };
}

async function recordTriggerFireViaApi(input: {
  triggerId: string;
  lastTriggered: string;
  nextTrigger: string;
}): Promise<{ success: boolean; error?: string }> {
  const result = await fireTriggerViaApi({
    triggerId: input.triggerId,
    referenceTime: input.lastTriggered,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}

async function runSchedulerMaintenanceViaApi(input?: {
  processDeliveries?: boolean;
  sweepOrphanedSubagents?: boolean;
  sweepStaleBusyAgents?: boolean;
  cleanupOldTasks?: boolean;
  cleanupHistoryArchives?: boolean;
  decayMemoryConfidence?: boolean;
}): Promise<{
  success: boolean;
  data?: {
    deliveries?: {
      sent: number;
      failed: number;
    } | null;
    staleBusyAgents?: {
      inspected: number;
      recovered: number;
      errored: number;
    } | null;
    tasksCleaned?: number;
    historyArchivesDeleted?: number;
    memoryDecay?: {
      decayed: number;
      archived: number;
    } | null;
  };
  error?: string;
}> {
  const response = await fetch(`${APP_BASE_URL}/api/scheduler/health`, {
    method: 'POST',
    headers: buildInternalAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input ?? {}),
  });

  const body = await response.json() as {
    success?: boolean;
    data?: {
      deliveries?: {
        sent: number;
        failed: number;
      } | null;
      staleBusyAgents?: {
        inspected: number;
        recovered: number;
        errored: number;
      } | null;
      tasksCleaned?: number;
      historyArchivesDeleted?: number;
      memoryDecay?: {
        decayed: number;
        archived: number;
      } | null;
    };
    error?: string;
  };

  if (!response.ok || !body.success) {
    return { success: false, error: body.error ?? `Scheduler maintenance failed with status ${response.status}` };
  }

  return { success: true, data: body.data };
}

// ============================================
// Heartbeat/Cron Trigger Processor
// ============================================
async function processDueTriggers() {
  try {
    const prisma = await getSchedulerPrisma();
    const now = new Date();
    
    // Find triggers that are due
    const dueTriggers = await prisma.trigger.findMany({
      where: {
        enabled: true,
        type: { in: ['heartbeat', 'cron'] },
        nextTrigger: { lte: now }
      },
      include: { agent: true }
    });

    for (const trigger of dueTriggers) {
      console.log(`[Scheduler] Firing trigger ${trigger.name} (${trigger.type})`);
      
      try {
        const fireResult = await fireTriggerViaApi({
          triggerId: trigger.id,
          referenceTime: now.toISOString(),
        });

        if (!fireResult.success || !fireResult.data) {
          throw new Error(fireResult.error ?? `Failed to fire trigger ${trigger.id}`);
        }

        triggersFired++;
        console.log(`[Scheduler] Fired trigger ${trigger.name}`);
      } catch (error) {
        console.error(`[Scheduler] Failed to fire trigger ${trigger.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error processing triggers:', error);
  }
}

// ============================================
// Cleanup Old Tasks
// ============================================
async function cleanupOldTasks() {
  try {
    const result = await runSchedulerMaintenanceViaApi({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: false,
      cleanupOldTasks: true,
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Task cleanup failed');
    }

    const cleaned = result.data?.tasksCleaned ?? 0;

    if (cleaned > 0) {
      console.log(`[Scheduler] Cleaned up ${cleaned} old tasks`);
    }
  } catch (error) {
    console.error('[Scheduler] Error cleaning up tasks:', error);
  }
}

async function runTaskLoop() {
  try {
    if (isRunning) {
      await processPendingTasks();
    }
  } catch (error) {
    console.error('[Scheduler] Error in task loop:', error);
  } finally {
    if (isRunning) {
      setTimeout(runTaskLoop, getRuntimeConfig().performance.pollInterval);
    }
  }
}

async function runTriggerLoop() {
  try {
    if (isRunning) {
      await processDueTriggers();
    }
  } catch (error) {
    console.error('[Scheduler] Error in trigger loop:', error);
  } finally {
    if (isRunning) {
      setTimeout(runTriggerLoop, getRuntimeConfig().performance.heartbeatInterval);
    }
  }
}

async function runDeliveryLoop() {
  try {
    const result = await runSchedulerMaintenanceViaApi({
      processDeliveries: true,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: true,
      cleanupOldTasks: false,
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Delivery maintenance failed');
    }

    deliveriesSent += result.data?.deliveries?.sent ?? 0;
    deliveriesFailed += result.data?.deliveries?.failed ?? 0;
  } catch (error) {
    console.error('[Scheduler] Error processing deliveries:', error);
  } finally {
    if (isRunning) {
      setTimeout(runDeliveryLoop, 5000);
    }
  }
}

// ============================================
// Main Loop
// ============================================
async function startAdapters(): Promise<void> {
  const adapters = getRegisteredAdapters();
  for (const adapter of adapters) {
    if (adapter.start) {
      try {
        await adapter.start();
        console.log(`[Scheduler] Adapter started: ${adapter.channel}`);
      } catch (error) {
        console.error(`[Scheduler] Adapter start failed (${adapter.channel}):`, error);
      }
    }
  }
}

async function stopAdapters(): Promise<void> {
  const adapters = getRegisteredAdapters();
  const STOP_TIMEOUT_MS = 5_000;
  await Promise.all(
    adapters
      .filter(a => typeof a.stop === 'function')
      .map(async (adapter) => {
        const timeout = new Promise<void>((resolve) => setTimeout(() => {
          console.warn(`[Scheduler] Adapter stop timed out: ${adapter.channel}`);
          resolve();
        }, STOP_TIMEOUT_MS));
        try {
          await Promise.race([adapter.stop!(), timeout]);
          console.log(`[Scheduler] Adapter stopped: ${adapter.channel}`);
        } catch (error) {
          console.error(`[Scheduler] Adapter stop error (${adapter.channel}):`, error);
        }
      }),
  );
}

const adapterWasConnected = new Map<string, boolean>();

async function checkAdapterHealth(): Promise<void> {
  const adapters = getRegisteredAdapters();
  for (const adapter of adapters) {
    if (typeof adapter.isConnected !== 'function') continue;

    const nowConnected = adapter.isConnected();
    const wasConnected = adapterWasConnected.get(adapter.channel) ?? false;

    if (!nowConnected && wasConnected) {
      console.log(`[Scheduler] Adapter disconnected, attempting recovery: ${adapter.channel}`);
      try {
        await adapter.start?.();
        console.log(`[Scheduler] Adapter recovered: ${adapter.channel}`);
      } catch (error) {
        console.error(`[Scheduler] Adapter recovery failed (${adapter.channel}):`, error);
      }
    }

    adapterWasConnected.set(adapter.channel, adapter.isConnected());
  }
}

async function start() {
  ensureInternalAuthConfigured('Scheduler');
  await getSchedulerPrisma();
  isRunning = true;
  initializeAdapters();
  await startAdapters();
  console.log('[Scheduler] Service started');

  // Initial processing
  await processPendingTasks();
  await processDueTriggers();
  void runDeliveryLoop();

  // Task polling loop
  void runTaskLoop();

  // Trigger check loop
  void runTriggerLoop();

  // Daily cleanup (at 3 AM)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Running daily cleanup');
    await cleanupOldTasks();

    try {
      const result = await runSchedulerMaintenanceViaApi({
        processDeliveries: false,
        sweepOrphanedSubagents: false,
        sweepStaleBusyAgents: false,
        cleanupOldTasks: false,
        cleanupHistoryArchives: true,
        decayMemoryConfidence: true,
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Daily maintenance failed');
      }

      const decayResult = result.data?.memoryDecay;
      if (decayResult) {
        console.log(`[Scheduler] Memory decay: ${decayResult.decayed} updated, ${decayResult.archived} archived`);
      }

      const historyArchivesDeleted = result.data?.historyArchivesDeleted ?? 0;
      if (historyArchivesDeleted > 0) {
        console.log(`[Scheduler] Cleaned up ${historyArchivesDeleted} archived history file(s)`);
      }
    } catch (error) {
      console.error('[Scheduler] Error during memory maintenance:', error);
    }
  });

  // Status logging every 5 minutes
  setInterval(() => {
    console.log(`[Scheduler] Status: ${tasksProcessed} tasks processed, ${triggersFired} triggers fired, ${deliveriesSent} deliveries sent, ${deliveriesFailed} deliveries failed`);
  }, 300000);

  // Adapter health check every 30 seconds
  setInterval(() => {
    if (isRunning) {
      checkAdapterHealth().catch(error => console.error('[Scheduler] Health check error:', error));
    }
  }, 30_000);
}

async function shutdown(): Promise<void> {
  console.log('[Scheduler] Shutting down...');
  isRunning = false;
  await stopAdapters();
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    prismaReady = null;
    prismaInitPromise = null;
  }
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

// Start the service
if (import.meta.main) {
  start().catch(console.error);
}

export {
  start,
  processPendingTasks,
  processDueTriggers,
  executeTaskViaApi,
  createTaskViaApi,
  fireTriggerViaApi,
  recordTriggerFireViaApi,
  runSchedulerMaintenanceViaApi,
};
