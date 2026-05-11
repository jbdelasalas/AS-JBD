import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Perpet ERP',
  description: 'ERP for Perpet Pilipinas Corp.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
