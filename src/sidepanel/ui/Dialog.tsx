import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    /** A line under the title. */
    description?: ReactNode;
    /** Buttons at the bottom, right-aligned: secondary first, the main one last. */
    actions?: ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'full';
    /** Clicking outside or Esc does nothing (a run is saving). */
    persistent?: boolean;
    /** No padding around the body (a table or a list that runs edge to edge). */
    flush?: boolean;
    closeLabel?: string;
    className?: string;
    children?: ReactNode;
}

const SIZES = { sm: 'max-w-[340px]', md: 'max-w-[440px]', lg: 'max-w-[640px]', full: 'max-w-[min(1100px,calc(100vw-32px))] h-[calc(100vh-32px)]' };

/**
 * A modal sheet on the browser's own <dialog>: it traps focus, closes on Esc and backdrop clicks,
 * and keeps the page behind from scrolling.
 */
export function Dialog({ open, onClose, title, description, actions, size = 'md', persistent, flush, closeLabel = 'Close', className, children }: DialogProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const close = useRef(onClose);
    close.current = onClose;

    useEffect(() => {
        const d = ref.current;
        if (!d) return;
        if (open && !d.open) {
            if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
        } else if (!open && d.open) {
            if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
        }
    }, [open]);

    return (
        <dialog ref={ref} aria-labelledby={title ? titleId : undefined}
            onCancel={e => { e.preventDefault(); if (!persistent) close.current(); }}
            onMouseDown={e => { if (e.target === e.currentTarget && !persistent) close.current(); }}
            className={cx(open ? 'flex' : 'hidden', 'm-auto max-h-[calc(100vh-32px)] w-[calc(100vw-24px)] flex-col overflow-hidden rounded-sheet border-[1.5px] border-line-strong bg-surface p-0 text-ink shadow-float animate-pop',
                'backdrop:bg-[rgb(22_19_15/0.45)] backdrop:backdrop-blur-[2px]', SIZES[size], className)}>
            {open && (title || !persistent) && (
                <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-2">
                    <div className="min-w-0 flex-1">
                        {title && <h2 id={titleId} className="m-0 font-display text-heading font-bold tracking-[-0.02em] text-ink">{title}</h2>}
                        {description && <p className="m-0 mt-0.5 text-small text-ink-2">{description}</p>}
                    </div>
                    {!persistent && (
                        <button type="button" aria-label={closeLabel} onClick={() => close.current()}
                            className="-mt-1 -mr-2 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-ink/7 hover:text-ink">
                            <X size={17} />
                        </button>
                    )}
                </div>
            )}
            {open && <div className={cx('min-h-0 flex-1 overflow-y-auto', !flush && 'px-5 pt-1 pb-4')}>{children}</div>}
            {open && actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{actions}</div>}
        </dialog>
    );
}
