'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, LayoutDashboard, Truck } from 'lucide-react';
import { APP_NAME } from '@haulbook/shared';
import { cx } from './ui';

const TABS = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/companies', label: 'Companies', Icon: Building2 },
] as const;

/** App title + the two tabs: Dashboard (convert, input folder) and Companies. */
export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Truck className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            ELD mileage reports → ProMiles trip summary import (TRIPSUMMARY2), saved per company
          </p>
        </div>
      </div>
      <nav className="flex gap-1 rounded-lg bg-muted p-1 sm:ml-auto" aria-label="Sections">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
