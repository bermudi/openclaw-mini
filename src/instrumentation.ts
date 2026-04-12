// OpenClaw Agent Runtime - Instrumentation Entry Point
// Runs at server startup via Next.js instrumentation API
// NOTE: Heavy initialization moved to lazy init on first request (see lib/init/lazy.ts)
// This avoids Turbopack crashes from complex import graphs during dev compilation

import { markSkillCacheDirty, resetSkillCacheDirtyForTests } from '@/lib/services/skill-cache-signal';

let skillCacheSighupHandler: (() => void) | null = null;

type NodeProcessLike = {
  env?: { NEXT_RUNTIME?: string; NODE_ENV?: string };
  [key: string]: unknown;
};

function getNodeProcess(): NodeProcessLike | undefined {
  return Reflect.get(globalThis, 'process') as unknown as NodeProcessLike | undefined;
}

function isEdgeRuntime(): boolean {
  const edgeRuntime = Reflect.get(globalThis, 'EdgeRuntime');
  if (typeof edgeRuntime === 'string') {
    return true;
  }

  return false;
}

function isUnsupportedEdgeProcessApiError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('not supported in the Edge Runtime');
}

function getProcessMethod(
  nodeProcess: NodeProcessLike | undefined,
  methodName: 'addListener' | 'removeListener',
): ((event: 'SIGHUP', listener: () => void) => unknown) | null {
  const candidate = nodeProcess?.[methodName];
  if (typeof candidate !== 'function') {
    return null;
  }

  return candidate as (event: 'SIGHUP', listener: () => void) => unknown;
}

export function registerSkillCacheSignalHandler(): void {
  if (skillCacheSighupHandler) {
    return;
  }

  // Skip if not in Node.js runtime (Edge Runtime doesn't support process.addListener)
  if (isEdgeRuntime()) {
    return;
  }

  try {
    const nodeProcess = getNodeProcess();
    const addListener = getProcessMethod(nodeProcess, 'addListener');
    if (!addListener) {
      return;
    }

    skillCacheSighupHandler = () => {
      markSkillCacheDirty();
    };

    addListener.call(nodeProcess, 'SIGHUP', skillCacheSighupHandler);
  } catch (error) {
    if (isUnsupportedEdgeProcessApiError(error)) {
      skillCacheSighupHandler = null;
      return;
    }

    throw error;
  }
}

export function resetSkillCacheSignalHandlerForTests(): void {
  if (!skillCacheSighupHandler) {
    return;
  }

  try {
    const nodeProcess = getNodeProcess();
    const removeListener = getProcessMethod(nodeProcess, 'removeListener');
    if (removeListener) {
      removeListener.call(nodeProcess, 'SIGHUP', skillCacheSighupHandler);
    }
  } catch (error) {
    if (!isUnsupportedEdgeProcessApiError(error)) {
      throw error;
    }
  }
  skillCacheSighupHandler = null;
  resetSkillCacheDirtyForTests();
}

export async function register() {
  // Always register signal handler (lightweight, no heavy imports)
  registerSkillCacheSignalHandler();

  // NOTE: Initialization now happens lazily on first API request via lib/init/lazy.ts
  // This avoids Turbopack crashes from heavy import graphs during dev compilation
}
