import { NextRequest, NextResponse } from 'next/server';
import {
  assertDashboardRuntimeProxyConfigured,
  buildRuntimeUrl,
  getRuntimeProxyHeaders,
} from '@/lib/runtime-proxy';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    assertDashboardRuntimeProxyConfigured();

    const runtimeUrl = new URL(buildRuntimeUrl('/api/sessions/messages'));
    runtimeUrl.search = request.nextUrl.search;

    const response = await fetch(runtimeUrl, {
      method: 'GET',
      headers: getRuntimeProxyHeaders(),
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
