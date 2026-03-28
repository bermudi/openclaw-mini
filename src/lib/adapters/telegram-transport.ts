export type TelegramTransport = 'webhook' | 'polling';

export function resolveTelegramTransport(value: string | undefined = process.env.TELEGRAM_TRANSPORT): TelegramTransport {
  const normalized = value?.trim().toLowerCase();

  return normalized === 'polling' ? 'polling' : 'webhook';
}
