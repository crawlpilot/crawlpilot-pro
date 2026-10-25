import { cx } from './cx';

/** A spinning ring in the current text colour. */
export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role={label ? 'status' : undefined} aria-label={label}
            className={cx('shrink-0 animate-spin', className)}>
            <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
            <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

interface ProgressProps {
    /** 0–100; leave out while the total is unknown. */
    value?: number;
    tone?: 'brand' | 'ink' | 'success' | 'danger';
    size?: 'sm' | 'md';
    className?: string;
    label?: string;
}

const BAR = { brand: 'bg-brand', ink: 'bg-ink', success: 'bg-success', danger: 'bg-danger' };

/** A bar: how far along, or a moving stripe while it isn't known. */
export function Progress({ value, tone = 'brand', size = 'md', className, label }: ProgressProps) {
    const known = typeof value === 'number';
    return (
        <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(value) : undefined}
            className={cx('relative w-full overflow-hidden rounded-full bg-ink/8', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}>
            {known
                ? <div className={cx('h-full rounded-full transition-[width] duration-300', BAR[tone], tone === 'brand' && 'border-r-[1.5px] border-line-strong')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                : <div className={cx('absolute inset-y-0 w-2/5 rounded-full animate-[cp-indeterminate_1.2s_ease-in-out_infinite]', BAR[tone])} />}
        </div>
    );
}

/** A grey placeholder in the shape of what is loading. */
export function Skeleton({ className, circle }: { className?: string; circle?: boolean }) {
    return <div aria-hidden className={cx('animate-pulse bg-ink/8', circle ? 'rounded-full' : 'rounded-md', className)} />;
}
