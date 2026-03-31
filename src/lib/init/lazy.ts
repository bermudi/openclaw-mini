// OpenClaw Agent Runtime - Lazy Initialization
// Ensures app initialization happens on first request, not at instrumentation time
// This avoids Turbopack crashes from heavy import graphs during dev compilation

import { initialize } from './index';
import type { InitResult } from './types';

let initPromise: Promise<InitResult> | null = null;

/**
 * Ensures the application is initialized, running initialization only once.
 * Called on first API request - subsequent requests use cached promise.
 */
export async function ensureInitialized(): Promise<InitResult> {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

/**
 * Reset the initialization state (for testing only)
 */
export function resetInitForTests(): void {
  initPromise = null;
}
