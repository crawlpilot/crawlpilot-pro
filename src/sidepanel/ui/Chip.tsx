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
