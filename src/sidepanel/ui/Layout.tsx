import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from './cx';

/** The spacing scale for gaps: 0.5 → 2 px … 6 → 24 px. */
export type Gap = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6;
const GAPS: Record<Gap, string> = { 0: 'gap-0', 0.5: 'gap-0.5', 1: 'gap-1', 1.5: 'gap-1.5', 2: 'gap-2', 2.5: 'gap-2.5', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5', 6: 'gap-6' };

const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' };
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' };

interface FlexProps extends HTMLAttributes<HTMLDivElement> {
    gap?: Gap;
    align?: keyof typeof ALIGN;
    justify?: keyof typeof JUSTIFY;
    wrap?: boolean;
}

/** Things one under another. */
export const Stack = forwardRef<HTMLDivElement, FlexProps>(function Stack({ gap = 2, align, justify, wrap, className, ...rest }, ref) {
    return <div ref={ref} className={cx('flex flex-col', GAPS[gap], align && ALIGN[align], justify && JUSTIFY[justify], wrap && 'flex-wrap', className)} {...rest} />;
});

/** Things side by side, centred on one line unless told otherwise. */
export const Row = forwardRef<HTMLDivElement, FlexProps>(function Row({ gap = 2, align = 'center', justify, wrap, className, ...rest }, ref) {
    return <div ref={ref} className={cx('flex flex-row', GAPS[gap], ALIGN[align], justify && JUSTIFY[justify], wrap && 'flex-wrap', className)} {...rest} />;
});

/** A thin line between groups. */
export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
    return <hr className={cx('m-0 shrink-0 border-0 bg-line', vertical ? 'w-px self-stretch' : 'h-px w-full', className)} />;
}
