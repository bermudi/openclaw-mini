// API Route: /api/scheduler/health
// Periodic health check: runs delivery processing and orphaned sub-agent sweep.
// Call this endpoint from an external cron (e.g. node-cron, system cron) at the desired interval.

import { NextResponse } from 'next/server';
import { taskQueue } from '@/lib/services/task-queue';
import { processPendingDeliveries } from '@/lib/services/delivery-service';

// POST /api/scheduler/health - Run periodic health-check tasks
export async function POST() {
  try {
    const [deliveryStats, sweptCount] = await Promise.all([
      processPendingDeliveries(),
      taskQueue.sweepOrphanedSubagents(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        deliveries: deliveryStats,
        orphanedSubagentsSwept: sweptCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET /api/scheduler/health - Health probe (no side effects)
export async function GET() {
  return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });
}
