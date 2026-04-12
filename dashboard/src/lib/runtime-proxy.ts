import fs from 'fs';
import path from 'path';

function normalizeUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, '');
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function readEnvFileValue(envName: string): string | undefined {
  const rootDir = path.resolve(process.cwd(), '..');

  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(rootDir, fileName);
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
      if (key !== envName) {
        continue;
      }

      return trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    }
  }

  return undefined;
}

function getEnvValue(envName: string): string | undefined {
  return process.env[envName]?.trim() || readEnvFileValue(envName);
}

export function getRuntimeApiBaseUrl(): string {
  const configured = getEnvValue('NEXT_PUBLIC_OPENCLAW_API_URL')
    || getEnvValue('OPENCLAW_APP_URL')
    || 'http://localhost:3000';

  return normalizeUrl(configured);
}

export function buildRuntimeUrl(routePath: string): string {
  return new URL(routePath, `${getRuntimeApiBaseUrl()}/`).toString();
}

export function getRuntimeProxyHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getEnvValue('OPENCLAW_API_KEY');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

export function isInsecureLocalAuthAllowedForDashboard(): boolean {
  return parseBoolean(getEnvValue('OPENCLAW_ALLOW_INSECURE_LOCAL'));
}

export function assertDashboardRuntimeProxyConfigured(): void {
  const token = getEnvValue('OPENCLAW_API_KEY');
  if (!token && !isInsecureLocalAuthAllowedForDashboard()) {
    throw new Error('Dashboard runtime proxy is missing OPENCLAW_API_KEY. Set OPENCLAW_API_KEY or enable OPENCLAW_ALLOW_INSECURE_LOCAL=true for local-only testing.');
  }
}
