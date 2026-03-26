// API Route: /api/scheduler/health
// Periodic health check: runs delivery processing and orphaned sub-agent sweep.
// Call this endpoint from an external cron (e.g. node-cron, system cron) at the desired interval.

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { storageErrorResponse } from '@/lib/api/storage-errors';
import { db } from '@/lib/db';
import { taskQueue } from '@/lib/services/task-queue';
import { processPendingDeliveries } from '@/lib/services/delivery-service';
import { memoryService } from '@/lib/services/memory-service';
import { getSqliteBusyMetrics } from '@/lib/sqlite-concurrency';

// POST /api/scheduler/health - Run periodic health-check tasks
export async function POST(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    const body = await request.json().catch(() => ({})) as {
      processDeliveries?: boolean;
      sweepOrphanedSubagents?: boolean;
      sweepStaleBusyAgents?: boolean;
      cleanupOldTasks?: boolean;
      cleanupHistoryArchives?: boolean;
      decayMemoryConfidence?: boolean;
    };

    const operations = {
      processDeliveries: body.processDeliveries ?? true,
      sweepOrphanedSubagents: body.sweepOrphanedSubagents ?? true,
      sweepStaleBusyAgents: body.sweepStaleBusyAgents ?? true,
      cleanupOldTasks: body.cleanupOldTasks ?? false,
      cleanupHistoryArchives: body.cleanupHistoryArchives ?? false,
      decayMemoryConfidence: body.decayMemoryConfidence ?? false,
    };

    const [deliveryStats, sweptCount, staleBusyAgents, cleanedTasks, historyArchivesDeleted, memoryDecay] = await Promise.all([
      operations.processDeliveries ? processPendingDeliveries() : Promise.resolve(null),
      operations.sweepOrphanedSubagents ? taskQueue.sweepOrphanedSubagents() : Promise.resolve(0),
      operations.sweepStaleBusyAgents ? taskQueue.sweepStaleBusyAgents() : Promise.resolve(null),
      operations.cleanupOldTasks ? taskQueue.cleanupOldTasks() : Promise.resolve(0),
      operations.cleanupHistoryArchives ? cleanupHistoryArchivesForAllAgents() : Promise.resolve(0),
      operations.decayMemoryConfidence ? memoryService.decayMemoryConfidence() : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        deliveries: deliveryStats,
        orphanedSubagentsSwept: sweptCount,
        staleBusyAgents,
        tasksCleaned: cleanedTasks,
        historyArchivesDeleted,
        memoryDecay,
        sqliteBusy: getSqliteBusyMetrics(),
      },
    });
  } catch (error) {
    const storageResponse = storageErrorResponse(error);
    if (storageResponse) return storageResponse;

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/scheduler/health - Health probe (no side effects)
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    sqliteBusy: getSqliteBusyMetrics(),
  });
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
