import fs from 'fs';
import path from 'path';
import { runtimeLifecycle } from '@/lib/runtime/lifecycle';

function loadEnvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
}

let shuttingDown = false;

async function shutdown(exitCode: number): Promise<never> {
  if (!shuttingDown) {
    shuttingDown = true;
    try {
      await runtimeLifecycle.stop();
    } catch (error) {
      console.error('[Runtime] Shutdown failed:', error);
      process.exit(1);
    }
  }

  process.exit(exitCode);
}

async function main(): Promise<void> {
  loadEnvFiles();
  await runtimeLifecycle.start();
  console.log(`[Runtime] Ready on port ${runtimeLifecycle.getRealtimePort()}`);
}

if (import.meta.main) {
  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });

  main().catch(async (error) => {
    console.error('[Runtime] Startup failed:', error);
    await shutdown(1);
  });
}
