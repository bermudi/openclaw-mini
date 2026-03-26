import { NextResponse } from 'next/server'
import { getSqliteBusyFailureMessage, isSqliteBusyError } from '@/lib/sqlite-concurrency'

export function storageErrorResponse(error: unknown): NextResponse | null {
  if (!isSqliteBusyError(error)) {
    return null
  }

  return NextResponse.json(
    {
      success: false,
      error: getSqliteBusyFailureMessage(),
    },
    { status: 503 },
  )
}
