import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Progress';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold select-none rounded-control '
    + 'transition-[background-color,border-color,color,box-shadow,transform] duration-150 '
    + 'disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer';

/** The pressable ones sit on a hard shadow and push into it. */
const PRESS = 'shadow-press hover:not-disabled:-translate-x-px hover:not-disabled:-translate-y-px hover:not-disabled:shadow-[3px_3px_0_0_var(--cp-press)] '
    + 'active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px] active:not-disabled:shadow-none';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: `bg-primary text-on-primary hover:not-disabled:bg-primary-hover border-[1.5px] border-primary ${PRESS}`,
    brand: `bg-brand text-on-brand border-[1.5px] border-line-strong ${PRESS}`,
    secondary: 'bg-surface text-ink border-[1.5px] border-line-strong hover:not-disabled:bg-surface-2 active:not-disabled:translate-y-px',
    ghost: 'bg-transparent text-ink-2 hover:not-disabled:bg-ink/6 hover:not-disabled:text-ink active:not-disabled:bg-ink/10',
    danger: 'bg-transparent text-danger border-[1.5px] border-danger/45 hover:not-disabled:bg-danger-soft active:not-disabled:translate-y-px',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-small [&_svg]:size-3.5',
    md: 'h-9 px-4 text-body [&_svg]:size-4',
    lg: 'h-11 px-5 text-lead [&_svg]:size-[18px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Icon before the label. */
    icon?: ReactNode;
    /** Icon after the label. */
    iconEnd?: ReactNode;
    loading?: boolean;
    fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'secondary', size = 'md', icon, iconEnd, loading, fullWidth, disabled, className, children, type = 'button', ...rest }, ref,
) {
    return (
        <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
            className={cx(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)} {...rest}>
            {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon}
            {children}
            {iconEnd}
        </button>
    );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** What it does: the accessible name and the tooltip. */
    label: string;
    size?: ButtonSize;
    variant?: 'ghost' | 'secondary' | 'danger';
    /** Shows it as switched on (a toggle in a toolbar). */
    active?: boolean;
    /** Hide the tooltip (when the label is shown next to it already). */
    noTooltip?: boolean;
}

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'size-7 [&_svg]:size-3.5', md: 'size-8 [&_svg]:size-4', lg: 'size-10 [&_svg]:size-5' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { label, size = 'md', variant = 'ghost', active, noTooltip, className, children, type = 'button', ...rest }, ref,
) {
    const button = (
        <button ref={ref} type={type} aria-label={label} aria-pressed={active}
            className={cx(BASE, 'shrink-0', ICON_SIZES[size], VARIANTS[variant], active && 'bg-brand! text-on-brand!', className)} {...rest}>
            {children}
        </button>
    );
    return noTooltip ? button : <Tooltip title={label}>{button}</Tooltip>;
});
