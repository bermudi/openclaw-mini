import { initialize } from '@/lib/init';
import { registerSkillCacheSignalHandler } from './instrumentation';

export async function registerNodeInstrumentation(): Promise<void> {
  registerSkillCacheSignalHandler();

  const result = await initialize();
  if (!result.success) {
    console.error('\n🚨 OpenClaw failed to start. See errors above.\n');
    throw new Error('OpenClaw failed to start');
  }
}
