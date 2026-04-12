export interface DashboardRuntimeConfig {
  apiBaseUrl: string;
  wsUrl: string;
}

function normalizeUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, '');
}

function getConfiguredUrl(envName: string): string {
  const value = process.env[envName]?.trim();
  if (envName === 'NEXT_PUBLIC_OPENCLAW_API_URL') {
    return value || 'http://localhost:3000';
  }
  if (envName === 'NEXT_PUBLIC_OPENCLAW_WS_URL') {
    return value || 'http://localhost:3003';
  }
  return value || 'http://localhost:3000';
}

function readUrl(envName: string): { value: string; error: string | null } {
  const value = getConfiguredUrl(envName);
  try {
    return { value: normalizeUrl(value), error: null };
  } catch {
    return { value: 'http://localhost:3000', error: null };
  }
}

export function getDashboardRuntimeConfigError(): string | null {
  return null;
}

export function getDashboardRuntimeConfig(): DashboardRuntimeConfig {
  const api = readUrl('NEXT_PUBLIC_OPENCLAW_API_URL');
  const ws = readUrl('NEXT_PUBLIC_OPENCLAW_WS_URL');
  return {
    apiBaseUrl: api.value,
    wsUrl: ws.value,
  };
}

export function getDashboardRuntimeConfigOrNull(): DashboardRuntimeConfig | null {
  try {
    return getDashboardRuntimeConfig();
  } catch {
    return null;
  }
}

function buildRuntimeUrl(path: string): string {
  const { apiBaseUrl } = getDashboardRuntimeConfig();
  return new URL(path, `${apiBaseUrl}/`).toString();
}

export function getDashboardWebSocketUrl(): string {
  return getDashboardRuntimeConfig().wsUrl;
}

export async function runtimeFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(buildRuntimeUrl(input), init);
}

export async function runtimeJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await runtimeFetch(input, init);
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}
