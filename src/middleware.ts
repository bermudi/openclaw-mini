import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeCorsHeaders, isRuntimeCorsOriginAllowed } from '@/lib/runtime-cors';

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    if (origin && !isRuntimeCorsOriginAllowed(origin)) {
      return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
    }

    return new NextResponse(null, {
      status: 204,
      headers: getRuntimeCorsHeaders(origin),
    });
  }

  const response = NextResponse.next();
  const corsHeaders = getRuntimeCorsHeaders(origin);

  for (const [name, value] of Object.entries(corsHeaders)) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
