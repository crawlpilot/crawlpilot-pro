import type { HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const TONES: Record<ChipTone, string> = {
    neutral: 'bg-ink/7 text-ink-2',
    brand: 'bg-brand text-on-brand',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    outline: 'bg-transparent text-ink-2 ring-1 ring-inset ring-line',
};

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
    tone?: ChipTone;
    size?: 'sm' | 'md';
    icon?: ReactNode;
    /** Shows an × that calls this. */
    onRemove?: () => void;
    removeLabel?: string;
}

/** A short status or tag: "Running", "3 fields", "price". */
export function Chip({ tone = 'neutral', size = 'sm', icon, onRemove, removeLabel = 'Remove', className, children, ...rest }: ChipProps) {
    return (
        <span className={cx('inline-flex max-w-full shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap',
            size === 'sm' ? 'h-5 px-2 text-[11px] [&_svg]:size-3' : 'h-6 px-2.5 text-caption [&_svg]:size-3.5', TONES[tone], className)} {...rest}>
            {icon}
            <span className="truncate">{children}</span>
            {onRemove && (
                <button type="button" aria-label={removeLabel} onClick={onRemove}
                    className="-mr-1 inline-flex cursor-pointer rounded-full p-0.5 opacity-70 hover:bg-ink/10 hover:opacity-100">
                    <X />
                </button>
            )}
        </span>
    );
}

/** A count bubble on an icon or tab. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-on-brand', className)}>{children}</span>;
}

interface ToggleChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    selected: boolean;
    icon?: ReactNode;
    /** A count on the right. */
    count?: ReactNode;
}

/** A chip that switches on and off: filters, type choices. Pressed ones are filled. */
export function ToggleChip({ selected, icon, count, className, children, type = 'button', ...rest }: ToggleChipProps) {
    return (
        <button type={type} aria-pressed={selected}
            className={cx('inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3 text-caption font-semibold whitespace-nowrap transition-colors duration-150 [&_svg]:size-3.5 disabled:cursor-not-allowed disabled:opacity-45',
                selected ? 'border-line-strong bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:border-ink/30 hover:text-ink', className)}
            {...rest}>
            {icon}{children}
            {count !== undefined && <span className={cx('tabular-nums', selected ? 'opacity-70' : 'text-ink-3')}>{count}</span>}
        </button>
    );
}
