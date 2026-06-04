import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#0f4c75',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL('https://erp.artfreshchicken.ph'),
  title: 'AFCC ERP System',
  description: 'Enterprise Resource Planning System for Art Fresh Creative Corporation',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AFCC ERP System',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/api/v1/company-icon' }],
    shortcut: '/api/v1/company-icon',
    apple: [{ url: '/api/v1/company-icon', sizes: '180x180' }],
  },
};

const isStaging = process.env.NEXT_PUBLIC_APP_ENV === 'staging';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={outfit.variable}>
      <body className={outfit.className}>
        {isStaging && (
          <div className="sticky top-0 z-[9999] bg-amber-400 text-amber-900 text-center text-xs font-semibold py-1 tracking-wide">
            SANDBOX — This is a test environment. Data here does not affect production.
          </div>
        )}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
