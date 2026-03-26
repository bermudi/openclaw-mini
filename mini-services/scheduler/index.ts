// OpenClaw Scheduler Service
// Background worker for task processing and trigger management

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { initializeAdapters, getRegisteredAdapters } from '../../src/lib/adapters';
import { processPendingDeliveries } from '../../src/lib/services/delivery-service';
import { memoryService } from '../../src/lib/services/memory-service';
import { getRuntimeConfig, getPrismaLogConfig } from '../../src/lib/config/runtime';
import { buildInternalAuthHeaders, ensureInternalAuthConfigured } from '../../src/lib/internal-auth';

const prisma = new PrismaClient({
  log: getPrismaLogConfig(),
});

const APP_BASE_URL = process.env.OPENCLAW_APP_URL || 'http://localhost:3000';

// Status tracking
let isRunning = false;
let tasksProcessed = 0;
let triggersFired = 0;
let deliveriesSent = 0;
let deliveriesFailed = 0;

console.log('[Scheduler] OpenClaw Scheduler Service starting...');

// ============================================
// Task Processor - Polls and executes pending tasks
// ============================================
async function processPendingTasks() {
  try {
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

// ============================================
// Heartbeat/Cron Trigger Processor
// ============================================
async function processDueTriggers() {
  try {
    const now = new Date();
    
    // Find triggers that are due
    const dueTriggers = await prisma.trigger.findMany({
      where: {
        enabled: true,
        nextTrigger: { lte: now }
      },
      include: { agent: true }
    });

    for (const trigger of dueTriggers) {
      console.log(`[Scheduler] Firing trigger ${trigger.name} (${trigger.type})`);
      
      try {
        // Create a task for this trigger
        const task = await prisma.task.create({
          data: {
            agentId: trigger.agentId,
            type: trigger.type === 'cron' ? 'cron' : 'heartbeat',
            priority: trigger.type === 'cron' ? 6 : 7,
            status: 'pending',
            payload: JSON.stringify({
              triggerId: trigger.id,
              triggeredAt: now.toISOString()
            }),
            source: `${trigger.type}:${trigger.name}`
          }
        });

        // Update trigger timestamps
        const config = JSON.parse(trigger.config);
        let nextTrigger: Date;

        if (trigger.type === 'heartbeat' && config.interval) {
          nextTrigger = new Date(now.getTime() + config.interval * 60000);
        } else if (trigger.type === 'cron' && config.cronExpression) {
          // Parse cron and get next occurrence
          nextTrigger = getNextCronDate(config.cronExpression);
        } else {
          // Default: add 1 hour
          nextTrigger = new Date(now.getTime() + 3600000);
        }

        await prisma.trigger.update({
          where: { id: trigger.id },
          data: {
            lastTriggered: now,
            nextTrigger
          }
        });

        triggersFired++;
        console.log(`[Scheduler] Created task ${task.id} for trigger ${trigger.name}`);
      } catch (error) {
        console.error(`[Scheduler] Failed to fire trigger ${trigger.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error processing triggers:', error);
  }
}

// ============================================
// Cron Expression Parser
// ============================================
type CronExpressionParser = {
  parseExpression?: (expression: string) => {
    next: () => {
      toDate: () => Date;
    };
  };
};

function getNextCronDate(expression: string): Date {
  try {
    const schedule = (cron as CronExpressionParser).parseExpression?.(expression);
    if (!schedule) {
      throw new Error('Cron expression parsing is unavailable');
    }
    return schedule.next().toDate();
  } catch (error) {
    console.error('[Scheduler] Invalid cron expression:', expression);
    // Fallback: 1 hour from now
    return new Date(Date.now() + 3600000);
  }
}

// ============================================
// Cleanup Old Tasks
// ============================================
async function cleanupOldTasks() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - getRuntimeConfig().retention.tasks);

    const result = await prisma.task.deleteMany({
      where: {
        status: { in: ['completed', 'failed'] },
        completedAt: { lt: cutoff }
      }
    });

    if (result.count > 0) {
      console.log(`[Scheduler] Cleaned up ${result.count} old tasks`);
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
    const stats = await processPendingDeliveries();
    deliveriesSent += stats.sent;
    deliveriesFailed += stats.failed;
  } catch (error) {
    console.error('[Scheduler] Error processing deliveries:', error);
  } finally {
    if (isRunning) {
      setTimeout(runDeliveryLoop, 2000);
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

    const agents = await prisma.agent.findMany({
      select: { id: true },
    });

    for (const agent of agents) {
      await memoryService.cleanupHistoryArchives(agent.id);
    }

    try {
      const decayResult = await memoryService.decayMemoryConfidence();
      console.log(`[Scheduler] Memory decay: ${decayResult.decayed} updated, ${decayResult.archived} archived`);
    } catch (error) {
      console.error('[Scheduler] Error during memory confidence decay:', error);
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
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

// Start the service
if (import.meta.main) {
  start().catch(console.error);
}

export { start, processPendingTasks, executeTaskViaApi };
