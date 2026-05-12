import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';

const aptos = localFont({
  src: [
    { path: '../../public/fonts/Aptos.ttf',         weight: '400', style: 'normal' },
    { path: '../../public/fonts/Aptos-Bold.ttf',    weight: '700', style: 'normal' },
    { path: '../../public/fonts/Aptos-Display.ttf', weight: '600', style: 'normal' },
  ],
  variable: '--font-aptos',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Perpet ERP',
  description: 'ERP for Perpet Pilipinas Corp.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={aptos.variable}>
      <body className={aptos.className}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
