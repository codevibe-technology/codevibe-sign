import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { THEME_COOKIE, isTheme } from '@/lib/preferences';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Codevibe Sign', template: '%s · Codevibe Sign' },
  description: 'Send documents for signature, track them and keep a verifiable record.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0D1B2A' },
    { media: '(prefers-color-scheme: dark)', color: '#07111C' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(saved) ? saved : 'system';
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
