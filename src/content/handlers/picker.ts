/** The visual element picker, the Page Extractor's selection highlights, and the selector test. */
import { VisualElementPicker } from '../features/picker/VisualElementPicker';
import { ListSelectionStrategy, readListFromChains } from '../features/picker/strategies/ListSelectionStrategy';
import { SingleSelectionStrategy } from '../features/picker/strategies/SingleSelectionStrategy';
import { DetailSelectionStrategy } from '../features/picker/strategies/DetailSelectionStrategy';
import { SelectionHighlightManager } from '../services/page/SelectionHighlightManager';
import { HL_COLOR, HL_BG, HL_GLOW, HL_GLOW_STRONG, DUR_VALIDATE, DUR_FADE } from '../utils/highlight-tokens';
import { fail, ok, on, send } from '../../shared/messages';

let picker: VisualElementPicker | null = null;
const selectionHighlights = new SelectionHighlightManager();

function startPicker(mode: 'list' | 'single' | 'detail' = 'list', action: 'extract' | 'click' = 'extract') {
    picker?.deactivate();
    picker = new VisualElementPicker();
    const strategy = mode === 'single' ? new SingleSelectionStrategy()
        : mode === 'detail' ? new DetailSelectionStrategy()
        : new ListSelectionStrategy();
    strategy.preferredAction = action;
    // Help the user find a "Next" button when picking one.
    if (mode === 'single') {
        try { scrollToLikelyNextButton(); } catch (e) { console.warn('Could not scroll to a next button:', e); }
    }
    picker.activate(strategy, () => { void send('PICKER_CANCELLED'); });
}

function stopPicker() {
    picker?.deactivate();
    picker = null;
}

const NEXT_WORDS = ['next', 'load more', 'show more', 'older', '>', '→', '»', 'continue', 'further', 'more results', 'next page', 'forward'];

/** Scores a candidate by semantic signals: higher is more likely the "Next" button. */
function nextScore(e: HTMLElement): number {
    const tag = e.tagName.toLowerCase();
    const text = e.textContent?.trim().toLowerCase() || '';
    const cls = (typeof e.className === 'string' ? e.className : '').toLowerCase();
    const aria = e.getAttribute('aria-label')?.toLowerCase() || '';
    let s = 0;
    if (tag === 'button') s += 5;
    else if (tag === 'a') s += 4;
    else if (e.getAttribute('role') === 'button') s += 3;
    if (text === 'next' || text === 'next >' || text === 'next page') s += 6;
    else if (text.startsWith('next')) s += 4;
    else if (text.includes('next')) s += 3;
    else if (text.includes('load more') || text.includes('show more')) s += 3;
    if (cls.includes('next') || cls.includes('pagination')) s += 2;
    if (aria.includes('next')) s += 2;
    if (e.onclick !== null || e.getAttribute('onclick')) s += 1;
    if (e.getBoundingClientRect().top + window.scrollY > document.body.scrollHeight * 0.5) s += 1;
    return s;
}

function scrollToLikelyNextButton() {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], span, div'))
        .filter(el => {
            const text = el.textContent?.toLowerCase().trim() || '';
            const title = el.getAttribute('title')?.toLowerCase() || '';
            const aria = el.getAttribute('aria-label')?.toLowerCase() || '';
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            if (!visible || rect.width > 500 || rect.height > 200) return false;
            return NEXT_WORDS.some(w => text === w || (text.includes(w) && text.length < 30) || title.includes(w) || aria.includes(w));
        })
        .sort((a, b) => nextScore(b) - nextScore(a));

    const best = candidates[0];
    if (!best) {
        // Pagination usually lives near the bottom.
        window.scrollTo({ top: document.body.scrollHeight * 0.7, behavior: 'smooth' });
        return;
    }
    best.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const { outline, outlineOffset } = best.style;
    best.style.outline = `2px solid ${HL_GLOW}`;
    best.style.outlineOffset = '2px';
    setTimeout(() => { best.style.outline = outline; best.style.outlineOffset = outlineOffset; }, 2000);
}

/** Outlines every match of a CSS or XPath selector for a moment. */
function testSelector(selector: string) {
    document.querySelectorAll('.crawlpilot-test-highlight').forEach(el => el.remove());
    const sel = selector.trim();
    const isXPath = /^(\/|\(|\.\/|id\()/.test(sel);
    let elements: Element[] = [];
    try {
        if (isXPath) {
            const result = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < result.snapshotLength; i++) {
                const node = result.snapshotItem(i);
                if (node instanceof Element) elements.push(node);
            }
        } else {
            elements = Array.from(document.querySelectorAll(sel));
        }
    } catch (e) {
        console.error('Test selector failed', e);
        return;
    }
    if (elements.length === 0) return;
    elements[0].scrollIntoView({ behavior: 'auto', block: 'center' });

    elements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'crawlpilot-test-highlight';
        box.style.cssText = `
            position: fixed !important; top: ${rect.top}px !important; left: ${rect.left}px !important;
            width: ${rect.width}px !important; height: ${rect.height}px !important;
            border: 2px solid ${HL_COLOR} !important; background-color: ${HL_BG} !important;
            z-index: 2147483647 !important; pointer-events: none !important;
            box-shadow: 0 0 12px ${HL_GLOW_STRONG} !important; border-radius: 4px !important;
            transition: opacity 0.3s ease !important;
        `;
        if (index < 20) {
            const label = document.createElement('div');
            label.textContent = `Match ${index + 1}`;
            label.style.cssText = `
                position: absolute !important; top: -24px !important; left: 0 !important;
                background: ${HL_COLOR} !important; color: #000 !important; font-size: 11px !important;
                font-family: sans-serif !important; font-weight: bold !important; padding: 3px 8px !important;
                border-radius: 4px !important; white-space: nowrap !important; box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            `;
            box.appendChild(label);
        }
        document.body.appendChild(box);
        setTimeout(() => {
            box.style.opacity = '0';
            setTimeout(() => box.remove(), DUR_FADE);
        }, DUR_VALIDATE);
    });
}

export function registerPickerHandlers() {
    on('START_PICKER', p => { startPicker(p?.mode, p?.action); return ok(); });
    on('STOP_PICKER', () => { stopPicker(); return ok(); });
    on('READ_LIST', ({ container, items }) => {
        const read = readListFromChains([...container], [...items]);
        return read ? ok(read) : fail('That list is no longer on the page');
    });
    on('PICKER_ACTION', p => { picker?.handleExternalAction(p.action); return ok(); });
    on('SHOW_SELECTION_HIGHLIGHTS', p => {
        if (Array.isArray(p?.elements)) selectionHighlights.showHighlights(p.elements);
        return ok();
    });
    on('CLEAR_SELECTION_HIGHLIGHTS', () => { selectionHighlights.clearHighlights(); return ok(); });
    on('ADD_SELECTION_HIGHLIGHT', p => {
        if (p?.element) selectionHighlights.addHighlight(p.element);
        return ok();
    });
    on('TEST_SELECTOR', p => {
        if (p?.selector) testSelector(p.selector);
        return ok();
    });
}
