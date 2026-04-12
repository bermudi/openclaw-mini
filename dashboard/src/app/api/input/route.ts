import { NextRequest, NextResponse } from 'next/server';
import {
  assertDashboardRuntimeProxyConfigured,
  buildRuntimeUrl,
  getRuntimeProxyHeaders,
} from '@/lib/runtime-proxy';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertDashboardRuntimeProxyConfigured();

    const body = await request.text();
    const response = await fetch(buildRuntimeUrl('/api/input'), {
      method: 'POST',
      headers: getRuntimeProxyHeaders({ 'Content-Type': 'application/json' }),
      body,
      cache: 'no-store',
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
