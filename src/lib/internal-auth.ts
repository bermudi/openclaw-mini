import { timingSafeEqual } from 'crypto';
import { auditService } from '@/lib/services/audit-service';

export const INTERNAL_AUTH_ENV_VAR = 'OPENCLAW_API_KEY';
export const INSECURE_LOCAL_AUTH_ENV_VAR = 'OPENCLAW_ALLOW_INSECURE_LOCAL';

export type InternalAuthFailureReason =
  | 'missing_token'
  | 'invalid_format'
  | 'invalid_token'
  | 'missing_config';

export type InternalAuthResult =
  | {
      ok: true;
      bypassed: boolean;
    }
  | {
      ok: false;
      reason: InternalAuthFailureReason;
    };

const warnedInsecureServices = new Set<string>();

function normalizeConfiguredToken(): string | null {
  const token = process.env[INTERNAL_AUTH_ENV_VAR]?.trim();
  return token ? token : null;
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function compareTokens(expectedToken: string, providedToken: string): boolean {
  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function getHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const rawValue = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(rawValue)) {
    return rawValue[0] ?? null;
  }

  return rawValue ?? null;
}

export function isInsecureLocalAuthAllowed(): boolean {
  return parseBooleanEnv(process.env[INSECURE_LOCAL_AUTH_ENV_VAR]);
}

export function getInternalAuthToken(): string | null {
  return normalizeConfiguredToken();
}

export function getInternalAuthHeaderValue(): string | null {
  const token = getInternalAuthToken();
  return token ? `Bearer ${token}` : null;
}

export function buildInternalAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const authorization = getInternalAuthHeaderValue();

  if (authorization) {
    headers.set('Authorization', authorization);
  }

  return headers;
}

export function getInternalAuthStartupStatus(): {
  secure: boolean;
  error?: string;
  warning?: string;
} {
  if (getInternalAuthToken()) {
    return { secure: true };
  }

  if (isInsecureLocalAuthAllowed()) {
    return {
      secure: false,
      warning: `${INSECURE_LOCAL_AUTH_ENV_VAR}=true disables bearer auth for admin APIs and trusted service endpoints. Use this only for local testing.`,
    };
  }

  return {
    secure: false,
    error: `Missing ${INTERNAL_AUTH_ENV_VAR}. Configure a bearer token for admin APIs and trusted service-to-service calls, or set ${INSECURE_LOCAL_AUTH_ENV_VAR}=true for local-only testing.`,
  };
}

export function ensureInternalAuthConfigured(serviceName: string): void {
  const status = getInternalAuthStartupStatus();

  if (status.error) {
    throw new Error(`[${serviceName}] ${status.error}`);
  }

  if (status.warning && !warnedInsecureServices.has(serviceName)) {
    warnedInsecureServices.add(serviceName);
    console.warn(`[${serviceName}] ${status.warning}`);
  }
}

export function verifyInternalBearerToken(
  authorizationHeader: string | string[] | null | undefined,
): InternalAuthResult {
  if (isInsecureLocalAuthAllowed()) {
    return { ok: true, bypassed: true };
  }

  const configuredToken = getInternalAuthToken();
  if (!configuredToken) {
    return { ok: false, reason: 'missing_config' };
  }

  const normalizedAuthorization = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (!normalizedAuthorization) {
    return { ok: false, reason: 'missing_token' };
  }

  if (!normalizedAuthorization.startsWith('Bearer ')) {
    return { ok: false, reason: 'invalid_format' };
  }

  const providedToken = normalizedAuthorization.slice('Bearer '.length).trim();
  if (!providedToken) {
    return { ok: false, reason: 'invalid_format' };
  }

  if (!compareTokens(configuredToken, providedToken)) {
    return { ok: false, reason: 'invalid_token' };
  }

  return { ok: true, bypassed: false };
}

export function getSourceIp(
  headers: Headers | Record<string, string | string[] | undefined>,
  remoteAddress?: string | null,
): string | null {
  const forwardedFor = getHeaderValue(headers, 'x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }

  const realIp = getHeaderValue(headers, 'x-real-ip');
  if (realIp) {
    return realIp.trim() || null;
  }

  return remoteAddress?.trim() || null;
}

export async function logInternalAuthFailure(input: {
  route: string;
  sourceIp?: string | null;
  reason: InternalAuthFailureReason;
  service: 'nextjs' | 'openclaw-ws';
}): Promise<void> {
  const sourceIp = input.sourceIp ?? 'unknown';

  console.warn(
    `[Auth] Rejected ${input.service} request for ${input.route} from ${sourceIp}: ${input.reason}`,
  );

  await auditService.log({
    action: 'auth_failed',
    entityType: 'auth',
    entityId: input.route,
    severity: 'warning',
    details: {
      route: input.route,
      sourceIp,
      reason: input.reason,
      service: input.service,
    },
  });
}

export function resetInternalAuthWarningsForTests(): void {
  warnedInsecureServices.clear();
}
