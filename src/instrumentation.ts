// OpenClaw Agent Runtime - Instrumentation Entry Point
// Runs at server startup via Next.js instrumentation API

import { initialize } from '@/lib/init';
import { clearSkillCache } from '@/lib/services/skill-service';

let skillCacheSighupHandler: (() => void) | null = null;

export function registerSkillCacheSignalHandler(): void {
  if (skillCacheSighupHandler) {
    return;
  }

  skillCacheSighupHandler = () => {
    clearSkillCache();
  };

  process.on('SIGHUP', skillCacheSighupHandler);
}

export function resetSkillCacheSignalHandlerForTests(): void {
  if (!skillCacheSighupHandler) {
    return;
  }

  process.off('SIGHUP', skillCacheSighupHandler);
  skillCacheSighupHandler = null;
}

export async function register() {
  registerSkillCacheSignalHandler();

  // Only run in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    const result = await initialize();

    if (!result.success) {
      console.error('\n🚨 OpenClaw failed to start. See errors above.\n');
      process.exit(1);
    }
  }
}
