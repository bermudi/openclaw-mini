// OpenClaw Agent Runtime - Webhook Security
// Signature verification for incoming webhooks

import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify GitHub webhook signature
 * GitHub sends: X-Hub-Signature-256: sha256=<hex_digest>
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): WebhookVerificationResult {
  if (!signature || !signature.startsWith('sha256=')) {
    return { valid: false, error: 'Missing or invalid signature format' };
  }

  const expectedSignature = signature.slice(7); // Remove 'sha256=' prefix
  
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const computedSignature = hmac.digest('hex');

  try {
    const expected = Buffer.from(expectedSignature, 'hex');
    const computed = Buffer.from(computedSignature, 'hex');
    
    if (expected.length !== computed.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const valid = timingSafeEqual(expected, computed);
    return { valid };
  } catch {
    return { valid: false, error: 'Signature comparison failed' };
  }
}

/**
 * Verify Slack webhook signature
 * Slack sends: X-Slack-Signature: v0=<hex_digest>
 * And timestamp: X-Slack-Request-Timestamp
 */
export function verifySlackSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  toleranceSeconds: number = 300
): WebhookVerificationResult {
  if (!signature || !signature.startsWith('v0=')) {
    return { valid: false, error: 'Missing or invalid Slack signature format' };
  }

  // Check timestamp to prevent replay attacks
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  
  if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > toleranceSeconds) {
    return { valid: false, error: 'Request timestamp outside tolerance window' };
  }

  const expectedSignature = signature.slice(3); // Remove 'v0=' prefix
  
  // Slack uses: v0:timestamp:payload
  const baseString = `v0:${timestamp}:${payload}`;
  
  const hmac = createHmac('sha256', secret);
  hmac.update(baseString);
  const computedSignature = hmac.digest('hex');

  try {
    const expected = Buffer.from(expectedSignature, 'hex');
    const computed = Buffer.from(computedSignature, 'hex');
    
    if (expected.length !== computed.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const valid = timingSafeEqual(expected, computed);
    return { valid };
  } catch {
    return { valid: false, error: 'Signature comparison failed' };
  }
}

/**
 * Verify generic HMAC signature
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256',
  prefix?: string
): WebhookVerificationResult {
  let expectedSignature = signature;
  
  if (prefix && signature.startsWith(prefix)) {
    expectedSignature = signature.slice(prefix.length);
  }

  const hmac = createHmac(algorithm, secret);
  hmac.update(payload);
  const computedSignature = hmac.digest('hex');

  try {
    const expected = Buffer.from(expectedSignature, 'hex');
    const computed = Buffer.from(computedSignature, 'hex');
    
    if (expected.length !== computed.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const valid = timingSafeEqual(expected, computed);
    return { valid };
  } catch {
    return { valid: false, error: 'Signature comparison failed' };
  }
}

/**
 * Verify webhook based on source type
 */
export function verifyWebhook(
  source: string,
  payload: string,
  headers: Record<string, string>,
  secret: string
): WebhookVerificationResult {
  switch (source.toLowerCase()) {
    case 'github':
      return verifyGitHubSignature(
        payload,
        headers['x-hub-signature-256'] || headers['x-hub-signature'],
        secret
      );
    
    case 'slack':
      return verifySlackSignature(
        payload,
        headers['x-slack-signature'] || '',
        headers['x-slack-request-timestamp'] || '',
        secret
      );
    
    default:
      // For unknown sources, try generic HMAC verification
      const signature = headers['x-signature'] || headers['x-webhook-signature'] || '';
      if (!signature) {
        // No signature provided - allow if no secret configured
        return { valid: !secret };
      }
      return verifyHmacSignature(payload, signature, secret);
  }
}

/**
 * Extract webhook event type from payload
 */
export function extractWebhookEvent(source: string, payload: Record<string, unknown>): string {
  switch (source.toLowerCase()) {
    case 'github':
      return (payload.action as string) || (payload.event as string) || 'unknown';
    
    case 'slack':
      const slackEvent = payload.event;
      const slackEventType =
        typeof slackEvent === 'object' && slackEvent !== null && 'type' in slackEvent
          ? (slackEvent as { type?: unknown }).type
          : undefined;
      return (payload.type as string) || (typeof slackEventType === 'string' ? slackEventType : 'unknown');
    
    case 'jira':
      return (payload.webhookEvent as string) || 'unknown';
    
    default:
      return 'received';
  }
}
