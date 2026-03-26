import { NextRequest, NextResponse } from 'next/server';
import {
  getSourceIp,
  logInternalAuthFailure,
  verifyInternalBearerToken,
} from '@/lib/internal-auth';

export async function requireInternalAuth(
  request: NextRequest,
  route = request.nextUrl.pathname,
): Promise<NextResponse | null> {
  const authResult = verifyInternalBearerToken(request.headers.get('authorization'));

  if (authResult.ok) {
    return null;
  }

  await logInternalAuthFailure({
    route,
    reason: authResult.reason,
    service: 'nextjs',
    sourceIp: getSourceIp(request.headers),
  });

  return NextResponse.json(
    { success: false, error: 'Unauthorized' },
    { status: 401 },
  );
}
