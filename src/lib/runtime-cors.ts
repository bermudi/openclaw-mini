import { getNetworkConfig } from '@/lib/config/runtime';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

function isLoopbackBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getRuntimeCorsAllowedOrigins(): string[] {
  const networkConfig = getNetworkConfig();
  const configuredOrigins = networkConfig.allowedOrigins;
  const rawOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : DEFAULT_ALLOWED_ORIGINS;

  const normalizedOrigins = rawOrigins.flatMap((origin) => {
    try {
      return [normalizeOrigin(origin)];
    } catch {
      return [];
    }
  });

  return Array.from(new Set(normalizedOrigins));
}

export function isRuntimeCorsOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    const normalizedOrigin = normalizeOrigin(origin);
    return getRuntimeCorsAllowedOrigins().includes(normalizedOrigin)
      || isLoopbackBrowserOrigin(normalizedOrigin);
  } catch {
    return false;
  }
}

export function getRuntimeCorsHeaders(
  origin: string | null | undefined,
): Record<string, string> {
  if (!origin || !isRuntimeCorsOriginAllowed(origin)) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}
