// OpenClaw Scheduler Service
// Background worker for task processing and trigger management

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POLL_INTERVAL = 5000; // 5 seconds
const HEARTBEAT_CHECK_INTERVAL = 60000; // 1 minute

// Status tracking
let isRunning = false;
let tasksProcessed = 0;
let triggersFired = 0;

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
        const response = await fetch(`http://localhost:3000/api/tasks/${task.id}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();
        
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
function getNextCronDate(expression: string): Date {
  try {
    const schedule = cron.parseExpression(expression);
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
    cutoff.setDate(cutoff.getDate() - 7);

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

// ============================================
// Main Loop
// ============================================
async function start() {
  isRunning = true;
  console.log('[Scheduler] Service started');

  // Task polling loop
  setInterval(async () => {
    if (isRunning) {
      await processPendingTasks();
    }
  }, POLL_INTERVAL);

  // Trigger check loop
  setInterval(async () => {
    if (isRunning) {
      await processDueTriggers();
    }
  }, HEARTBEAT_CHECK_INTERVAL);

  // Daily cleanup (at 3 AM)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Running daily cleanup');
    await cleanupOldTasks();
  });

  // Initial processing
  await processPendingTasks();
  await processDueTriggers();

  // Status logging every 5 minutes
  setInterval(() => {
    console.log(`[Scheduler] Status: ${tasksProcessed} tasks processed, ${triggersFired} triggers fired`);
  }, 300000);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Scheduler] Shutting down...');
  isRunning = false;
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Scheduler] Shutting down...');
  isRunning = false;
  await prisma.$disconnect();
  process.exit(0);
});

// Start the service
start().catch(console.error);
