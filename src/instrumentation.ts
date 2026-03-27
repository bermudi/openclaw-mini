// OpenClaw Agent Runtime - Instrumentation Entry Point
// Runs at server startup via Next.js instrumentation API

import { markSkillCacheDirty, resetSkillCacheDirtyForTests } from '@/lib/services/skill-cache-signal';

let skillCacheSighupHandler: (() => void) | null = null;

type NodeProcessLike = {
  env?: { NEXT_RUNTIME?: string };
  addListener?: (event: 'SIGHUP', listener: () => void) => unknown;
  removeListener?: (event: 'SIGHUP', listener: () => void) => unknown;
};

function getNodeProcess(): NodeProcessLike | undefined {
  return Reflect.get(globalThis, 'process') as NodeProcessLike | undefined;
}

interface InitResultLike {
  success: boolean;
}

const loadInitModule = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<{ initialize: () => Promise<InitResultLike> }>;

export function registerSkillCacheSignalHandler(): void {
  if (skillCacheSighupHandler) {
    return;
  }

  skillCacheSighupHandler = () => {
    markSkillCacheDirty();
  };

  getNodeProcess()?.addListener?.('SIGHUP', skillCacheSighupHandler);
}

export function resetSkillCacheSignalHandlerForTests(): void {
  if (!skillCacheSighupHandler) {
    return;
  }

  getNodeProcess()?.removeListener?.('SIGHUP', skillCacheSighupHandler);
  skillCacheSighupHandler = null;
  resetSkillCacheDirtyForTests();
}

export async function register() {
  registerSkillCacheSignalHandler();

  // Only run in Node.js runtime (not Edge)
  const nextRuntime = getNodeProcess()?.env?.NEXT_RUNTIME;
  if (nextRuntime === 'nodejs' || !nextRuntime) {
    const { initialize } = await loadInitModule('@/lib/init');
    const result = await initialize();

    if (!result.success) {
      console.error('\n🚨 OpenClaw failed to start. See errors above.\n');
      throw new Error('OpenClaw failed to start');
    }
  }
}
