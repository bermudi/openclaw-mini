// OpenClaw Agent Runtime - Instrumentation Entry Point
// Runs at server startup via Next.js instrumentation API

import { initialize } from '@/lib/init';

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    const result = await initialize();

    if (!result.success) {
      console.error('\n🚨 OpenClaw failed to start. See errors above.\n');
      process.exit(1);
    }
  }
}
