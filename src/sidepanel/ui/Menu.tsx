import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { layerFor } from './layer';

interface MenuProps {
    /** The element it opens from; null keeps it closed. */
    anchor: HTMLElement | null;
    onClose: () => void;
    /** Which edge of the anchor it lines up with. */
    align?: 'start' | 'end';
    className?: string;
    children: ReactNode;
}

const GAP = 4;

/** Where a popover goes: under the anchor, or above it when there is no room, kept on screen. */
export function placePopover(anchor: DOMRect, w: number, h: number, align: 'start' | 'end', view = { w: window.innerWidth, h: window.innerHeight }) {
    const below = anchor.bottom + GAP + h <= view.h - 4 || anchor.top - GAP - h < 4;
    const left = align === 'end' ? anchor.right - w : anchor.left;
    return {
        left: Math.min(Math.max(4, left), view.w - w - 4),
        top: below ? Math.min(anchor.bottom + GAP, view.h - h - 4) : anchor.top - GAP - h,
    };
}

function items(root: HTMLElement | null): HTMLElement[] {
    return root ? [...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')] : [];
}

/** A list of actions that opens from a button. Arrow keys move, Enter picks, Esc or a click outside closes. */
export function Menu({ anchor, onClose, align = 'start', className, children }: MenuProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    const open = !!anchor;

    useLayoutEffect(() => {
        if (!anchor || !ref.current) { setPos(null); return; }
        setPos(placePopover(anchor.getBoundingClientRect(), ref.current.offsetWidth, ref.current.offsetHeight, align));
    }, [anchor, align]);

    useEffect(() => {
        if (!open) return;
        items(ref.current)[0]?.focus();
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
        };
        const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
        document.addEventListener('mousedown', onDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onClose);
        };
    }, [open, anchor, onClose]);

    const onKey = (e: KeyboardEvent) => {
        const list = items(ref.current);
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); anchor?.focus(); }
    };

    if (!open) return null;
    return createPortal(
        <div ref={ref} role="menu" onKeyDown={onKey}
            className={cx('fixed z-[1400] min-w-[180px] max-w-[280px] overflow-y-auto rounded-2xl border-[1.5px] border-line-strong bg-surface p-1 text-ink shadow-float animate-pop',
                className)}
            style={pos ? { left: pos.left, top: pos.top, maxHeight: 'calc(100vh - 16px)' } : { left: -9999, top: 0 }}>
            {children}
        </div>,
        layerFor(anchor),
    );
}

interface MenuItemProps {
    onClick: () => void;
    icon?: ReactNode;
    /** Text on the right: a shortcut, a count. */
    hint?: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    /** Shows a tick: the current choice. */
    selected?: boolean;
    children: ReactNode;
}

export function MenuItem({ onClick, icon, hint, danger, disabled, selected, children }: MenuItemProps) {
    return (
        <div role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} aria-current={selected || undefined}
            onClick={() => { if (!disabled) onClick(); }}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); onClick(); } }}
            className={cx('flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-body outline-none select-none [&_svg]:size-4',
                danger ? 'text-danger focus:bg-danger-soft hover:bg-danger-soft' : 'text-ink focus:bg-ink/6 hover:bg-ink/6',
                selected && 'font-semibold', disabled && 'cursor-not-allowed opacity-45')}>
            {icon && <span className={cx('flex shrink-0', !danger && 'text-ink-2')}>{icon}</span>}
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {hint && <span className="shrink-0 text-caption text-ink-3">{hint}</span>}
            {selected && <span className="size-2 shrink-0 rounded-full bg-accent" />}
        </div>
    );
}

export function MenuDivider() {
    return <div role="separator" className="mx-1.5 my-1 h-px bg-line" />;
}
