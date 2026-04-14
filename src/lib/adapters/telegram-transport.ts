export type TelegramTransport = 'webhook' | 'polling';

export function resolveTelegramTransport(value?: string): TelegramTransport {
  const normalized = value?.trim().toLowerCase();

  return normalized === 'polling' ? 'polling' : 'webhook';
}
