import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type TextSize = 'caption' | 'small' | 'body' | 'lead';
export type TextTone = 'default' | 'muted' | 'faint' | 'accent' | 'success' | 'warning' | 'danger' | 'inherit';

const TONES: Record<TextTone, string> = {
    default: 'text-ink',
    muted: 'text-ink-2',
    faint: 'text-ink-3',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    inherit: '',
};

const SIZES: Record<TextSize, string> = { caption: 'text-caption', small: 'text-small', body: 'text-body', lead: 'text-lead' };

interface TextProps extends HTMLAttributes<HTMLElement> {
    size?: TextSize;
    tone?: TextTone;
    weight?: 'normal' | 'medium' | 'semibold' | 'bold';
    /** One line, cut with an ellipsis. */
    truncate?: boolean;
    /** At most this many lines. */
    lines?: number;
    mono?: boolean;
    as?: ElementType;
    children?: ReactNode;
}

const WEIGHTS = { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' };

/** Running text. Sizes and colours come from the tokens: pick a `size` and a `tone`, never a pixel value. */
export function Text({ size = 'body', tone = 'default', weight, truncate, lines, mono, as: As = 'p', className, style, children, ...rest }: TextProps) {
    return (
        <As className={cx('m-0', SIZES[size], TONES[tone], weight && WEIGHTS[weight], mono && 'font-mono', truncate && 'truncate', lines && 'overflow-hidden', className)}
            style={lines ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', ...style } : style} {...rest}>
            {children}
        </As>
    );
}

export type HeadingSize = 'display' | 'title' | 'heading' | 'lead' | 'label';

const HEADINGS: Record<HeadingSize, string> = {
    display: 'font-display text-display font-extrabold tracking-[-0.035em]',
    title: 'font-display text-title font-bold tracking-[-0.03em]',
    heading: 'font-display text-heading font-bold tracking-[-0.02em]',
    lead: 'text-lead font-semibold tracking-[-0.01em]',
    /** A small section label above a group: "Recent tables". */
    label: 'text-small font-semibold text-ink-2',
};

const DEFAULT_TAG: Record<HeadingSize, ElementType> = { display: 'h1', title: 'h1', heading: 'h2', lead: 'h3', label: 'h3' };

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
    size?: HeadingSize;
    as?: ElementType;
    truncate?: boolean;
    children?: ReactNode;
}

/** Titles and section labels, in the display face from `heading` up. */
export function Heading({ size = 'heading', as, truncate, className, children, ...rest }: HeadingProps) {
    const As = as ?? DEFAULT_TAG[size];
    return <As className={cx('m-0', size !== 'label' && 'text-ink', HEADINGS[size], truncate && 'truncate', className)} {...rest}>{children}</As>;
}
