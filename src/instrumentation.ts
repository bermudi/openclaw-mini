// OpenClaw Agent Runtime - Instrumentation Entry Point
// Runs at server startup via Next.js instrumentation API
// NOTE: Heavy initialization moved to lazy init on first request (see lib/init/lazy.ts)
// This avoids Turbopack crashes from complex import graphs during dev compilation

import { markSkillCacheDirty, resetSkillCacheDirtyForTests } from '@/lib/services/skill-cache-signal';

let skillCacheSighupHandler: (() => void) | null = null;

type NodeProcessLike = {
  env?: { NEXT_RUNTIME?: string; NODE_ENV?: string };
  addListener?: (event: 'SIGHUP', listener: () => void) => unknown;
  removeListener?: (event: 'SIGHUP', listener: () => void) => unknown;
};

function getNodeProcess(): NodeProcessLike | undefined {
  return Reflect.get(globalThis, 'process') as NodeProcessLike | undefined;
}

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
  // Always register signal handler (lightweight, no heavy imports)
  registerSkillCacheSignalHandler();

  // NOTE: Initialization now happens lazily on first API request via lib/init/lazy.ts
  // This avoids Turbopack crashes from heavy import graphs during dev compilation
}
