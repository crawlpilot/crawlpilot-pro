import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'plain' | 'sunken' | 'brand' | 'lilac' | 'sky' | 'peach' | 'mint' | 'butter';

const TONES: Record<Tone, string> = {
    plain: 'bg-surface border border-line',
    sunken: 'bg-surface-2 border border-transparent',
    brand: 'bg-brand text-on-brand border-[1.5px] border-line-strong',
    lilac: 'bg-tile-lilac border border-transparent',
    sky: 'bg-tile-sky border border-transparent',
    peach: 'bg-tile-peach border border-transparent',
    mint: 'bg-tile-mint border border-transparent',
    butter: 'bg-tile-butter border border-transparent',
};

const PADS = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' };

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    tone?: Tone;
    pad?: keyof typeof PADS;
    /** A thick ink outline with the hard shadow: the one card on a screen that matters most. */
    raised?: boolean;
}

/** A surface that groups things. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ tone = 'plain', pad = 'md', raised, className, ...rest }, ref) {
    return <div ref={ref} className={cx('rounded-card', TONES[tone], PADS[pad], raised && 'border-[1.5px]! border-line-strong! shadow-press', className)} {...rest} />;
});

export interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: Tone;
    pad?: keyof typeof PADS;
    children?: ReactNode;
}

/** A whole card that is one button: tool tiles, list rows that open something. */
export const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(function CardButton({ tone = 'plain', pad = 'md', className, type = 'button', ...rest }, ref) {
    return (
        <button ref={ref} type={type}
            className={cx('block w-full cursor-pointer rounded-card text-left text-ink transition-[transform,box-shadow,border-color,background-color] duration-150',
                TONES[tone], PADS[pad],
                'hover:-translate-y-px hover:border-line-strong hover:shadow-press active:translate-y-0 active:shadow-none disabled:opacity-50 disabled:pointer-events-none',
                className)}
            {...rest} />
    );
});
