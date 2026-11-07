import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@haulbook/shared';
import { AppHeader } from '@/components/app-header';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Convert ELD mileage reports into ProMiles trip summary imports, per company.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <AppHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
