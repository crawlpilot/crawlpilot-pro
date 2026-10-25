import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { layerFor } from './layer';

const DELAY = 450;
const GAP = 6;

interface TooltipProps {
    title: ReactNode;
    /** One element that takes mouse and focus events (a button, a link, a span). */
    children: ReactElement<any>;
    placement?: 'top' | 'bottom';
}

/** A small label on hover or keyboard focus, after a short delay. An empty title shows nothing. */
export function Tooltip({ title, children, placement = 'top' }: TooltipProps) {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const host = useRef<HTMLElement>(document.body);
    const timer = useRef<number>(0);
    const tip = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    useLayoutEffect(() => {
        if (!anchor || !tip.current) { setPos(null); return; }
        const w = tip.current.offsetWidth;
        const h = tip.current.offsetHeight;
        const above = placement === 'top' ? anchor.top - h - GAP >= 4 : anchor.bottom + h + GAP > window.innerHeight - 4;
        const left = Math.min(Math.max(4, anchor.left + anchor.width / 2 - w / 2), window.innerWidth - w - 4);
        setPos({ left, top: above ? anchor.top - h - GAP : anchor.bottom + GAP });
    }, [anchor, placement]);

    if (!title || !isValidElement(children)) return children;
    const child = children as ReactElement<any>;
    const p = child.props;
    const show = (e: SyntheticEvent<HTMLElement>) => {
        const el = e.currentTarget;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { host.current = layerFor(el); setAnchor(el.getBoundingClientRect()); }, DELAY);
    };
    const hide = () => { window.clearTimeout(timer.current); setAnchor(null); };

    return (
        <>
            {cloneElement(child, {
                onMouseEnter: (e: SyntheticEvent<HTMLElement>) => { p.onMouseEnter?.(e); show(e); },
                onMouseLeave: (e: SyntheticEvent<HTMLElement>) => { p.onMouseLeave?.(e); hide(); },
                onFocus: (e: SyntheticEvent<HTMLElement>) => { p.onFocus?.(e); if ((e.currentTarget as HTMLElement).matches(':focus-visible')) show(e); },
                onBlur: (e: SyntheticEvent<HTMLElement>) => { p.onBlur?.(e); hide(); },
                onClick: (e: SyntheticEvent<HTMLElement>) => { p.onClick?.(e); hide(); },
            })}
            {anchor && createPortal(
                <div ref={tip} role="tooltip"
                    className="pointer-events-none fixed z-[1500] max-w-[260px] rounded-lg bg-ink px-2.5 py-1.5 text-caption font-medium text-bg shadow-float break-words animate-fade-in"
                    style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
                    {title}
                </div>,
                host.current,
            )}
        </>
    );
}
