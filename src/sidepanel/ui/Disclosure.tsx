import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';

/**
 * Shows or hides its children with a height animation. Hidden children stay mounted but are
 * invisible and inert, so they keep their state and can't be tabbed to.
 */
export function Collapse({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
    return (
        <div className={cx('grid transition-[grid-template-rows,visibility] duration-200 ease-out', open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]', className)}
            inert={!open || undefined} aria-hidden={!open || undefined}>
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    );
}

interface DisclosureProps {
    summary: ReactNode;
    /** An icon before the summary. */
    icon?: ReactNode;
    /** Text or a chip on the right of the summary. */
    meta?: ReactNode;
    defaultOpen?: boolean;
    open?: boolean;
    onToggle?: (open: boolean) => void;
    /** `card` is a bordered box; `plain` is a text row ("More tools ⌄"). */
    variant?: 'card' | 'plain';
    className?: string;
    children: ReactNode;
}

/** A heading that opens and closes the section under it. */
export function Disclosure({ summary, icon, meta, defaultOpen = false, open: controlled, onToggle, variant = 'card', className, children }: DisclosureProps) {
    const [own, setOwn] = useState(defaultOpen);
    const open = controlled ?? own;
    const id = useId();
    const toggle = () => { const next = !open; setOwn(next); onToggle?.(next); };
    const card = variant === 'card';

    return (
        <div className={cx(card && 'rounded-card border border-line bg-surface', className)}>
            <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}
                className={cx('flex w-full cursor-pointer items-center gap-2 text-left',
                    card ? 'rounded-card px-4 py-3 text-body font-semibold text-ink hover:bg-ink/3' : 'rounded-lg py-1 text-small font-semibold text-ink-2 hover:text-ink')}>
                {icon && <span className="flex shrink-0 text-ink-2 [&_svg]:size-4">{icon}</span>}
                <span className={cx('min-w-0', card && 'flex-1')}>{summary}</span>
                {meta && <span className="shrink-0 text-caption font-normal text-ink-3">{meta}</span>}
                <ChevronDown size={card ? 17 : 15} className={cx('shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-180')} />
            </button>
            <Collapse open={open}><div id={id} className={card ? 'px-4 pb-4' : 'pt-2'}>{children}</div></Collapse>
        </div>
    );
}
