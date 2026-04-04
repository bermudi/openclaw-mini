export interface DashboardRuntimeConfig {
  apiBaseUrl: string;
  wsUrl: string;
}

function normalizeUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, '');
}

function getConfiguredUrl(envName: string): string | null {
  const value = process.env[envName]?.trim();
  return value ? value : null;
}

function readUrl(envName: string): { value: string | null; error: string | null } {
  const value = getConfiguredUrl(envName);
  if (!value) {
    return {
      value: null,
      error: `[dashboard-runtime-client] Missing ${envName}. Configure the dashboard package with the runtime endpoint before starting it.`,
    };
  }

  try {
    return { value: normalizeUrl(value), error: null };
  } catch {
    return {
      value: null,
      error: `[dashboard-runtime-client] Invalid ${envName}: ${value}`,
    };
  }
}

export function getDashboardRuntimeConfigError(): string | null {
  const api = readUrl('NEXT_PUBLIC_OPENCLAW_API_URL');
  if (api.error) {
    return api.error;
  }

  const ws = readUrl('NEXT_PUBLIC_OPENCLAW_WS_URL');
  return ws.error;
}

export function getDashboardRuntimeConfig(): DashboardRuntimeConfig {
  const api = readUrl('NEXT_PUBLIC_OPENCLAW_API_URL');
  if (api.error || !api.value) {
    throw new Error(api.error ?? '[dashboard-runtime-client] Missing NEXT_PUBLIC_OPENCLAW_API_URL.');
  }

  const ws = readUrl('NEXT_PUBLIC_OPENCLAW_WS_URL');
  if (ws.error || !ws.value) {
    throw new Error(ws.error ?? '[dashboard-runtime-client] Missing NEXT_PUBLIC_OPENCLAW_WS_URL.');
  }

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
