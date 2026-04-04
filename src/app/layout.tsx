import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OpenClaw Runtime',
  description: 'OpenClaw Mini runtime API host.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
