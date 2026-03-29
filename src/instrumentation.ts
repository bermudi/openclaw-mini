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
  const nextRuntime = getNodeProcess()?.env?.NEXT_RUNTIME;
  if (nextRuntime !== 'edge') {
    const { registerNodeInstrumentation } = await import('./instrumentation-node');
    await registerNodeInstrumentation();
  }
}
