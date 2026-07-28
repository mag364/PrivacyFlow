import React from 'react';
import clsx from 'clsx';
import { Loader2, Inbox } from 'lucide-react';

// -----------------------------------------------------------------------------
// Liquid Glass component primitives. Presentational only; they read the CSS
// design tokens defined in styles/index.css so they adapt to theme, contrast,
// transparency, and motion settings automatically.
// -----------------------------------------------------------------------------

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--pf-highlight)] text-ink',
  info: 'bg-sky-500/15 text-sky-300',
  success: 'bg-emerald-500/15 text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-red-500/15 text-red-300',
};

export function GlassBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-capsule px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'subtle' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-glass',
  subtle: 'bg-[var(--pf-surface)] text-ink border border-line hover:bg-[var(--pf-highlight)]',
  ghost: 'text-muted hover:bg-[var(--pf-highlight)] hover:text-ink',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 shadow-glass',
};

export function GlassButton({
  variant = 'subtle',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-capsule px-4 py-2 text-sm font-medium transition-all focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      style={{ transitionDuration: 'var(--pf-motion-fast)', transitionTimingFunction: 'var(--pf-ease)' }}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const FIELD_BASE =
  'w-full rounded-xl border border-line bg-[var(--pf-surface)] px-3 py-2 text-sm text-ink placeholder:text-muted transition-all focus-ring disabled:opacity-60';

export const GlassInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function GlassInput({ className, ...rest }, ref) {
    return <input ref={ref} className={clsx(FIELD_BASE, className)} {...rest} />;
  },
);

export const GlassSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function GlassSelect({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={clsx(FIELD_BASE, 'appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const GlassTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function GlassTextarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={clsx(FIELD_BASE, 'resize-y', className)} {...rest} />;
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function GlassPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={clsx('glass p-5', className)}>{children}</div>;
}

export function GlassCard({
  children,
  className,
  interactive = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
}) {
  const Comp: React.ElementType = interactive ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={clsx(
        'glass p-4 text-left',
        interactive && 'cursor-pointer transition-all hover:shadow-glass-lg hover:-translate-y-0.5 focus-ring w-full',
        className,
      )}
      style={interactive ? { transitionDuration: 'var(--pf-motion-fast)', transitionTimingFunction: 'var(--pf-ease)' } : undefined}
    >
      {children}
    </Comp>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--pf-highlight)] text-muted">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      </div>
    </div>
  );
}