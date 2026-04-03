// API Route: /api/scheduler/health
// Periodic health check: runs delivery processing and orphaned sub-agent sweep.
// Call this endpoint from an external cron (e.g. node-cron, system cron) at the desired interval.

import { NextRequest, NextResponse } from 'next/server';
import { requireInternalAuth } from '@/lib/api-auth';
import { storageErrorResponse } from '@/lib/api/storage-errors';
import { getSqliteBusyMetrics } from '@/lib/sqlite-concurrency';
import { initializeAdapters } from '@/lib/adapters';
import { runRuntimeMaintenance, type RuntimeMaintenanceOptions } from '@/lib/runtime/maintenance';

// POST /api/scheduler/health - Run periodic health-check tasks
export async function POST(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

    // Ensure adapters are registered for delivery processing
    initializeAdapters();

    const body = await request.json().catch(() => ({})) as RuntimeMaintenanceOptions;
    const result = await runRuntimeMaintenance(body);

    return NextResponse.json({
      success: true,
      data: result,
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
