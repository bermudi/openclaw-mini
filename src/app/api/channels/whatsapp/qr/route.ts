import { NextResponse } from 'next/server';
import { getAdapter } from '@/lib/services/delivery-service';
import type { WhatsAppAdapter } from '@/lib/adapters/whatsapp-adapter';

export async function GET(): Promise<Response> {
  const adapter = getAdapter('whatsapp') as WhatsAppAdapter | undefined;

  if (!adapter) {
    return NextResponse.json({ success: false, error: 'WhatsApp adapter is not enabled' }, { status: 503 });
  }

  if (adapter.isConnected()) {
    return NextResponse.json({ success: true, connected: true, message: 'WhatsApp is already connected' });
  }

  return new Promise<Response>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(NextResponse.json({ success: false, error: 'QR code timed out — please try again' }, { status: 408 }));
    }, 65_000);

    adapter.onQr((qr: string) => {
      clearTimeout(timeout);
      resolve(NextResponse.json({ success: true, qr }));
    });

    adapter.start().catch((error: unknown) => {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : 'Failed to start WhatsApp adapter';
      resolve(NextResponse.json({ success: false, error: message }, { status: 500 }));
    });
  });
}
