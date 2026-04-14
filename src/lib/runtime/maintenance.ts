import { db } from '@/lib/db';
import { taskQueue } from '@/lib/services/task-queue';
import { processPendingDeliveries } from '@/lib/services/delivery-service';
import { memoryService } from '@/lib/services/memory-service';
import { getSqliteBusyMetrics } from '@/lib/sqlite-concurrency';

export interface RuntimeMaintenanceOptions {
  processDeliveries?: boolean;
  sweepOrphanedSubagents?: boolean;
  sweepStaleBusyAgents?: boolean;
  sweepErrorAgents?: boolean;
  cleanupOldTasks?: boolean;
  cleanupHistoryArchives?: boolean;
  decayMemoryConfidence?: boolean;
}

export interface RuntimeMaintenanceResult {
  deliveries: {
    sent: number;
    failed: number;
  } | null;
  orphanedSubagentsSwept: number;
  staleBusyAgents: Awaited<ReturnType<typeof taskQueue.sweepStaleBusyAgents>> | null;
  errorAgents: Awaited<ReturnType<typeof taskQueue.sweepErrorAgents>> | null;
  tasksCleaned: number;
  historyArchivesDeleted: number;
  memoryDecay: Awaited<ReturnType<typeof memoryService.decayMemoryConfidence>> | null;
  sqliteBusy: ReturnType<typeof getSqliteBusyMetrics>;
}

export function resolveRuntimeMaintenanceOptions(input: RuntimeMaintenanceOptions = {}): Required<RuntimeMaintenanceOptions> {
  return {
    processDeliveries: input.processDeliveries ?? true,
    sweepOrphanedSubagents: input.sweepOrphanedSubagents ?? true,
    sweepStaleBusyAgents: input.sweepStaleBusyAgents ?? true,
    sweepErrorAgents: input.sweepErrorAgents ?? true,
    cleanupOldTasks: input.cleanupOldTasks ?? false,
    cleanupHistoryArchives: input.cleanupHistoryArchives ?? false,
    decayMemoryConfidence: input.decayMemoryConfidence ?? false,
  };
}

export async function runRuntimeMaintenance(input: RuntimeMaintenanceOptions = {}): Promise<RuntimeMaintenanceResult> {
  const operations = resolveRuntimeMaintenanceOptions(input);

  const [deliveryStats, orphanedSubagentsSwept, staleBusyAgents, errorAgents, tasksCleaned, historyArchivesDeleted, memoryDecay] = await Promise.all([
    operations.processDeliveries ? processPendingDeliveries() : Promise.resolve(null),
    operations.sweepOrphanedSubagents ? taskQueue.sweepOrphanedSubagents() : Promise.resolve(0),
    operations.sweepStaleBusyAgents ? taskQueue.sweepStaleBusyAgents() : Promise.resolve(null),
    operations.sweepErrorAgents ? taskQueue.sweepErrorAgents() : Promise.resolve(null),
    operations.cleanupOldTasks ? taskQueue.cleanupOldTasks() : Promise.resolve(0),
    operations.cleanupHistoryArchives ? cleanupHistoryArchivesForAllAgents() : Promise.resolve(0),
    operations.decayMemoryConfidence ? memoryService.decayMemoryConfidence() : Promise.resolve(null),
  ]);

  return {
    deliveries: deliveryStats,
    orphanedSubagentsSwept,
    staleBusyAgents,
    errorAgents,
    tasksCleaned,
    historyArchivesDeleted,
    memoryDecay,
    sqliteBusy: getSqliteBusyMetrics(),
  };
}

async function cleanupHistoryArchivesForAllAgents(): Promise<number> {
  const agents = await db.agent.findMany({
    select: { id: true },
  });

  let deleted = 0;
  for (const agent of agents) {
    deleted += await memoryService.cleanupHistoryArchives(agent.id);
  }

  return deleted;
}
