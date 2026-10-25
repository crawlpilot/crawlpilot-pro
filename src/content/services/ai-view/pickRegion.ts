/**
 * "Ask about something on the page" (docs/plans/summarize-ask-plan.md A5): the user points at an
 * image, a chart, a table or any element, and the side panel gets where it is on screen to crop from
 * a capture of the tab. Works for what can't be read as a file too (canvas charts, SVG, cross-origin
 * images, text drawn as images).
 */
import type { PickedRegion } from '../../../shared/ai/page';

const VISUAL = 'img, picture, canvas, svg, video, figure, table';
const MIN_SIZE = 24;
let active: (() => void) | null = null;

function candidate(el: Element): Element {
    const visual = el.closest(VISUAL);
    const r = visual?.getBoundingClientRect();
    return visual && r && r.width >= MIN_SIZE && r.height >= MIN_SIZE ? visual : el;
}

function labelOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const alt = (el.getAttribute('alt') || el.getAttribute('aria-label') || el.querySelector('figcaption, caption')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const kind = tag === 'img' || tag === 'picture' ? 'Image' : tag === 'canvas' || tag === 'svg' ? 'Chart or drawing' : tag === 'video' ? 'Video frame' : tag === 'table' ? 'Table' : tag === 'figure' ? 'Figure' : 'Part of the page';
    return alt ? `${kind}: ${alt}` : kind;
}

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

export function pickRegion(): Promise<PickedRegion | null> {
    active?.();
    return new Promise(resolve => {
        const box = document.createElement('div');
        box.setAttribute('data-crawlpilot-pick', '');
        box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #facc15;background:rgba(250,204,21,.12);border-radius:4px;display:none;';
        const tip = document.createElement('div');
        tip.setAttribute('data-crawlpilot-pick', '');
        tip.textContent = 'Click what to ask about · Esc to cancel';
        tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);pointer-events:none;background:#111;color:#fff;font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:999px;';
        document.documentElement.append(box, tip);
        let current: Element | null = null;

        const move = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (!target || target.hasAttribute?.('data-crawlpilot-pick')) return;
            current = candidate(target);
            const r = current.getBoundingClientRect();
            Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        };
        /** Where `el` is now, clipped to the viewport; null when it is off screen. */
        const regionOf = (el: Element): PickedRegion | null => {
            const r = el.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            const x = Math.max(0, r.left), y = Math.max(0, r.top);
            const width = Math.min(vw, r.right) - x, height = Math.min(vh, r.bottom) - y;
            return width > 4 && height > 4 ? { x, y, width, height, viewportWidth: vw, viewportHeight: vh, label: labelOf(el) } : null;
        };
        const finish = async (picked: Element | null) => {
            cleanup();
            // The outline gone from the screen before the capture, and the page still (a scroll still
            // running moves it): measured last, just before the capture.
            await frame();
            await frame();
            await new Promise(r => setTimeout(r, 120));
            // Until the page stops scrolling (a smooth scroll still running), at most a second.
            for (let i = 0, last = scrollY; i < 60; i++) {
                await frame();
                if (scrollY === last) break;
                last = scrollY;
            }
            resolve(picked ? regionOf(picked) : null);
        };
        const click = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            void finish(current ?? candidate(e.target as Element));
        };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); void finish(null); } };
        const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
        const cleanup = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('click', click, true);
            document.removeEventListener('mousedown', block, true);
            document.removeEventListener('keydown', key, true);
            box.remove();
            tip.remove();
            active = null;
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('click', click, true);
        document.addEventListener('mousedown', block, true);
        document.addEventListener('keydown', key, true);
        active = () => void finish(null);
    });
}
