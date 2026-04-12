import { NextResponse, type NextRequest } from 'next/server';

// Dashboard-only no-op proxy.
// Keeps the standalone dashboard app from inheriting the root app's proxy file.
export function proxy(_request: NextRequest): NextResponse {
  return NextResponse.next();
}

export const config = {
  matcher: ['/__dashboard_noop_proxy__'],
};
