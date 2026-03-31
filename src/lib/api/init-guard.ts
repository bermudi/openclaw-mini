// OpenClaw Agent Runtime - API Init Guard
// Wraps API handlers to ensure lazy initialization before processing requests

import { ensureInitialized } from '@/lib/init/lazy';
import { NextResponse } from 'next/server';

/**
 * Wraps an API handler to ensure initialization happens before handling the request.
 * Returns 503 Service Unavailable if initialization fails.
 */
export async function withInit<T>(
  handler: () => Promise<T>
): Promise<T | NextResponse> {
  try {
    const result = await ensureInitialized();
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Service initialization failed' },
        { status: 503 }
      );
    }
    try {
      return await handler();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Handler error';
      return NextResponse.json(
        { success: false, error: message },
        { status: 503 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Service not ready';
    return NextResponse.json(
      { success: false, error: message },
      { status: 503 }
    );
  }
}
