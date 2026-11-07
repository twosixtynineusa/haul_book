import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({
  title,
  step,
  action,
  children,
  className,
}: {
  title: string;
  step?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx('rounded-lg border border-border bg-card text-card-foreground', className)}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold">
          {step !== undefined && (
            <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">
              {step}
            </span>
          )}
          {title}
        </h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-input bg-card hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
};

export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    BUTTON_VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

const ALERT_STYLES = {
  success: { box: 'bg-success-bg text-success', Icon: CheckCircle2 },
  warning: { box: 'bg-warning-bg text-warning', Icon: AlertTriangle },
  danger: { box: 'bg-danger-bg text-danger', Icon: XCircle },
} as const;

export function Alert({
  tone,
  title,
  children,
}: {
  tone: keyof typeof ALERT_STYLES;
  title?: string;
  children?: ReactNode;
}) {
  const { box, Icon } = ALERT_STYLES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-md px-4 py-3 text-sm', box)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
