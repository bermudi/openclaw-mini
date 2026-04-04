const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

export function getRuntimeCorsAllowedOrigins(): string[] {
  const configuredOrigins = process.env.OPENCLAW_ALLOWED_ORIGINS?.trim();
  const rawOrigins = configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
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
    return getRuntimeCorsAllowedOrigins().includes(normalizeOrigin(origin));
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
