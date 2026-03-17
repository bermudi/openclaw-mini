// API Route: /api/audit
// Audit log endpoints

import { NextRequest, NextResponse } from 'next/server';
import { auditService } from '@/lib/services/audit-service';

// GET /api/audit - Get audit logs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity') as 'info' | 'warning' | 'error' | 'critical' | null;
    const action = searchParams.get('action');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;

    const logs = await auditService.getRecentLogs({
      severity: severity || undefined,
      action: action || undefined,
      limit,
    });

    const stats = await auditService.getStats();
    const anomalies = await auditService.detectAnomalies();

    return NextResponse.json({
      success: true,
      data: logs,
      stats,
      anomalies,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
