import type { ReactNode } from 'react';
import { cx } from './cx';

interface EmptyStateProps {
    icon?: ReactNode;
    title: ReactNode;
    children?: ReactNode;
    /** One button: the way out of the empty state. */
    action?: ReactNode;
    className?: string;
}

/** Nothing here yet: one picture, one line, one button. */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
    return (
        <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
            {icon && (
                <div className="mb-4 flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press [&_svg]:size-6">
                    {icon}
                </div>
            )}
            <h3 className="m-0 font-display text-heading font-bold tracking-[-0.02em] text-ink">{title}</h3>
            {children && <p className="m-0 mt-1 max-w-[280px] text-small text-ink-2">{children}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}
