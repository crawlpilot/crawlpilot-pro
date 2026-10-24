/**
 * Finds one Page Extractor element on the page and extracts (or clicks) it. Runs in tabs that are
 * often in the background, so nothing waits on the page's own timers, which hidden tabs throttle:
 * highlights are fire-and-forget, scrolling is instant, and every wait (a click's answer, an element
 * to appear, a scroll step) is timed by the service worker (`utils/clock.ts`).
 */
import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { DataExtractor } from '../../extraction/DataExtractor';
import { atomText, isTextAtom, readValue } from '../../extraction/atoms';
import { clickElementRobust } from '../../../utils/click';
import { settle } from '../../../utils/settle';
import { sleep, until } from '../../../utils/clock';
import { whileShown } from '../reveal';
import { readBinding } from '../dataBinding';
import { looksLikeXPath, resolveOne } from '../../../../shared/selectors/resolve';
import { shapeOf } from '../../../../shared/extraction/shape';
import { extractColumns, collapseTableToJson } from './columnHelpers';

export class ElementProcessor {
    private extractor = new DataExtractor();

    constructor(private config: ExtractionConfig) { }

    /** `waitFor`: wait for the element to appear (it follows a click that reveals it). */
    async processElement(elementDef: ElementDefinition, opts: { waitFor?: boolean } = {}): Promise<ProcessedElementResult> {
        const result: ProcessedElementResult = {
            elementId: elementDef.id,
            elementName: elementDef.name,
            success: false,
            error: null,
            data: null,
            columns: []
        };

        try {
            if (this.config?.waitForElements || opts.waitFor) {
                const timeout = this.config.elementTimeout > 0 ? this.config.elementTimeout : opts.waitFor ? 8000 : 5000;
                await this.waitForElement(elementDef.selectors, timeout);
            }

            // Not in the DOM yet: scroll the page to wake lazy loaders; then look for it with a looser selector.
            let element = this.find(elementDef.selectors) ?? await this.scrollPageToReveal(elementDef.selectors);
            if (!element && elementDef.action !== 'click') {
                element = this.heal(elementDef);
                if (element) result.healed = true;
            }
            if (!element) {
                result.error = `Element "${elementDef.name}" not found after full page scroll`;
                return result;
            }

            this.highlight(element, elementDef.name);
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
            window.dispatchEvent(new Event('scroll'));
            document.dispatchEvent(new Event('scroll'));

            if (elementDef.action === 'click') {
                result.step = await this.click(element);
                result.success = result.step !== 'no-effect';
                if (!result.success) result.error = `Clicking "${elementDef.name}" changed nothing on the page`;
                return result;
            }
            // Content in a collapsed section is read as if it were shown (`reveal.ts`).
            const actionResult = whileShown(element, () => this.extract(elementDef, element));

            if (actionResult.success) {
                result.success = true;
                result.data = actionResult.data;
                result.columns = extractColumns(elementDef, actionResult);
            } else {
                result.error = actionResult.error;
            }
            return result;
        } catch (error: any) {
            result.error = error.message;
            return result;
        }
    }

    /**
     * The element read from the page's data (`dataBinding.ts`), when it is bound and the data is on
     * this page; null otherwise (then it is read from the page).
     */
    fromData(def: ElementDefinition): ProcessedElementResult | null {
        if (!def.data || def.action === 'click') return null;
        const v = readBinding(def.data);
        // Picked in "Data on this page": no selectors to fall back on, so missing data is an empty value.
        const dataOnly = !def.selectors?.length;
        if (v === undefined && !dataOnly) return null;
        const base = { elementId: def.id, elementName: def.name, success: true, error: null, fromData: true };
        if (def.data.names) {
            // A list of the page's items: one row each, its columns the picked attributes.
            const columns = def.data.names.map((name: string, i: number) => ({ id: `${def.id}_c${i}`, name, type: 'text', elementId: def.id, elementName: def.name }));
            const rows = Array.isArray(v) ? v as string[][] : [];
            const items = rows.map(r => Object.fromEntries(columns.map((c: { id: string }, i: number) => [c.id, r[i] ?? ''])));
            return { ...base, data: { type: 'list', items }, columns };
        }
        if (v === undefined) return { ...base, data: { [def.id]: null }, columns: extractColumns(def, { success: true, data: {} }) };
        if (typeof v === 'string') return { ...base, data: { [def.id]: v }, columns: extractColumns(def, { success: true, data: { [def.id]: v } }) };
        if (def.data.as === 'list') return { ...base, data: { [def.id]: v }, columns: extractColumns(def, { success: true, data: { [def.id]: v } }) };
        const rows = v as string[][];
        const width = Math.max(...rows.map(r => r.length));
        const columns = Array.from({ length: width }, (_, i) => ({ id: `column_${i + 1}`, name: `Column ${i + 1}`, type: 'text' }));
        const items = rows.map(r => Object.fromEntries(r.map((c, i) => [`column_${i + 1}`, c])));
        const actionResult = {
            success: true,
            data: { [def.id]: collapseTableToJson(items, columns), [def.id + '__tabledata']: JSON.stringify({ items, columns }) },
            _columnCount: width,
        } as ExtractionResult;
        return { ...base, data: actionResult.data, columns: extractColumns(def, actionResult) };
    }

    /**
     * The element when its selectors no longer match (a redesign, an A/B variant): each CSS selector
     * loosened, nearest steps kept (`.specs > table` → `table`), positions dropped (`li:nth-of-type(3)`).
     * Taken only when exactly one element matches and, for text, its value is the kind picked (a
     * price is still a price).
     */
    private heal(def: ElementDefinition): HTMLElement | null {
        const fits = (el: Element) => {
            if (!def.shape || (def.type || 'text') !== 'text') return true;
            const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            return !!text && shapeOf(text) === def.shape;
        };
        for (const selector of def.selectors) {
            if (looksLikeXPath(selector)) continue;
            const steps = selector.replace(/^:scope\s*>\s*/, '').split(/\s*>\s*|\s+/).filter(Boolean);
            const loose = (s: string) => s.replace(/:nth-(of-type|child)\(\d+\)/g, '');
            const tries = new Set<string>();
            for (let k = steps.length; k >= 1; k--) {
                tries.add(steps.slice(-k).join(' '));
                tries.add(steps.slice(-k).map(loose).filter(Boolean).join(' '));
            }
            for (const t of tries) {
                if (!t || t === selector) continue;
                let found: Element[] = [];
                try { found = Array.from(document.querySelectorAll(t)); } catch { continue; }
                const ok = found.filter(fits);
                if (ok.length === 1) return ok[0] as HTMLElement;
            }
        }
        return null;
    }

    private find(selectors: string[]): HTMLElement | null {
        return resolveOne(selectors).result as HTMLElement | null;
    }

    private highlight(element: HTMLElement, elementName?: string): void {
        try {
            if (!document.getElementById('crawlpilot-extraction-highlight-styles')) {
                const style = document.createElement('style');
                style.id = 'crawlpilot-extraction-highlight-styles';
                style.textContent = `
                    @keyframes crawlpilot-extract-pulse {
                        0% { box-shadow: 0 0 10px rgba(34, 211, 238, 0.3); }
                        100% { box-shadow: 0 0 25px rgba(34, 211, 238, 0.7); }
                    }
                `;
                document.head.appendChild(style);
            }

            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed !important;
                top: ${rect.top}px !important;
                left: ${rect.left}px !important;
                width: ${rect.width}px !important;
                height: ${rect.height}px !important;
                border: 3px solid #22D3EE !important;
                background-color: rgba(34, 211, 238, 0.12) !important;
                z-index: 2147483646 !important;
                pointer-events: none !important;
                border-radius: 4px !important;
                animation: crawlpilot-extract-pulse 0.6s ease-in-out infinite alternate !important;
            `;

            if (elementName) {
                const label = document.createElement('div');
                label.textContent = `⚡ ${elementName}`;
                label.style.cssText = `
                    position: absolute !important;
                    top: -28px !important;
                    left: 0 !important;
                    background: #22D3EE !important;
                    color: #000 !important;
                    font-size: 11px !important;
                    font-weight: bold !important;
                    padding: 3px 10px !important;
                    border-radius: 4px !important;
                    font-family: system-ui, -apple-system, sans-serif !important;
                    white-space: nowrap !important;
                `;
                overlay.appendChild(label);
            }

            overlay.setAttribute('data-crawlpilot-overlay', '');
            document.documentElement.appendChild(overlay);

            const duration = Math.max(this.config?.actionSpeed || 0, 1200);
            setTimeout(() => {
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.3s ease';
                setTimeout(() => overlay.remove(), 300);
            }, duration);
        } catch (_e) {
            // Highlight is best-effort; never block extraction
        }
    }

    private async waitForElement(selectors: string[], timeout: number): Promise<void> {
        await until(() => !!this.find(selectors), timeout);
    }

    private extract(elementDef: ElementDefinition, element: HTMLElement): ExtractionResult {
        const type = elementDef.type || 'text';
        let value: string | null = null;

        switch (type) {
            case 'text':
                // One value told twice (a screen-reader copy and a shown one) reads as shown (`atomText`).
                value = (element as any).value || (isTextAtom(element) ? atomText(element) : element.innerText) || element.textContent;
                break;
            // Links and images read the way list fields read them (absolute URLs, lazy `data-src`,
            // the largest `srcset` candidate), so a page element and a list field agree.
            case 'link_url':
            case 'link': {
                const link = element.closest('a[href]') ?? element.querySelector('a[href]');
                value = (link && readValue(link, 'href')) || element.innerText;
                break;
            }
            case 'image_url':
            case 'image': {
                const img = element.tagName === 'IMG' ? element : element.querySelector('img');
                if (img) {
                    value = readValue(img, 'src');
                } else {
                    const style = window.getComputedStyle(element);
                    value = style.backgroundImage && style.backgroundImage !== 'none'
                        ? style.backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
                        : null;
                }
                break;
            }
            case 'image_array': {
                const srcs = Array.from(element.querySelectorAll('img')).map(img => readValue(img, 'src')).filter(Boolean);
                return { success: true, data: { [elementDef.id]: [...new Set(srcs)] } };
            }
            case 'link_array': {
                const hrefs = Array.from(element.querySelectorAll('a[href]')).map(a => readValue(a, 'href')).filter(Boolean);
                return { success: true, data: { [elementDef.id]: [...new Set(hrefs)] } };
            }
            case 'text_array': {
                // Each child's text; through wrappers with one child; a block of lines (`<br>`) by line.
                const skipTags = new Set(['BR', 'HR', 'SCRIPT', 'STYLE', 'LINK', 'META']);
                const kidsOf = (el: Element) => Array.from(el.children).filter(c => !skipTags.has(c.tagName));
                let box: Element = element;
                while (kidsOf(box).length === 1 && kidsOf(kidsOf(box)[0]).length > 0) box = kidsOf(box)[0];
                const kids = kidsOf(box);
                const texts = kids.length > 1
                    ? kids.map(c => ((c as HTMLElement).innerText || c.textContent || '').replace(/\s+/g, ' ').trim())
                    : ((box as HTMLElement).innerText || box.textContent || '').split(/\n+/).map(t => t.replace(/\s+/g, ' ').trim());
                return { success: true, data: { [elementDef.id]: texts.filter(Boolean) } };
            }
            case 'smart':
            case 'list': {
                const listData = this.containerRows(element, 'list', elementDef.fields);
                if (listData.items.length > 0) return { success: true, data: listData, columns: listData.columns };
                value = element.innerText || element.textContent;
                break;
            }
            case 'table': {
                const tableData = this.containerRows(element, 'table', elementDef.fields);
                if (tableData.items.length > 0) {
                    return {
                        success: true,
                        data: {
                            [elementDef.id]: collapseTableToJson(tableData.items, tableData.columns),
                            [elementDef.id + '__tabledata']: JSON.stringify({ items: tableData.items, columns: tableData.columns })
                        },
                        _columnCount: tableData.columns.length
                    } as ExtractionResult;
                }
                value = element.innerText || element.textContent;
                break;
            }
            default:
                value = element.innerText;
        }

        return { success: true, data: { [elementDef.id]: value ? value.trim() : value } };
    }

    /**
     * Clicks a control and checks that it did something: the page changed (DOM, an `aria-expanded` /
     * `aria-selected` / `open` state, the URL). A control already open is not clicked (a second
     * click would close it). A plain click that changes nothing is tried again with the full pointer
     * sequence, and then the control's own markup is followed: a `<summary>` opens its `<details>`,
     * `aria-controls` shows its panel.
     */
    private async click(element: HTMLElement): Promise<ClickStep> {
        const control = element.closest<HTMLElement>('[aria-expanded], [aria-selected], summary') ?? element;
        if (isOpen(control)) return 'already-open';
        const wait = Math.max(this.config?.clickWaitMs || 0, 1500);
        const changed = async (act: () => void | Promise<unknown>) => {
            const before = stateOf(control);
            let mutations = 0;
            const observer = new MutationObserver(list => { mutations += list.filter(m => !isOurs(m)).length; });
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
            await act();
            await settle(document.body, 300, wait);
            observer.disconnect();
            return mutations > 0 || stateOf(control) !== before;
        };
        if (await changed(() => element.click())) return 'clicked';
        if (await changed(() => clickElementRobust(element))) return 'clicked';
        return openByMarkup(control) ? 'opened' : 'no-effect';
    }

    /** Scrolls the whole page a viewport at a time (so lazy loaders fire), looking for the element at each step. */
    private async scrollPageToReveal(selectors: string[]): Promise<HTMLElement | null> {
        const viewportHeight = window.innerHeight || 800;
        const STEP_DELAY_MS = 600;
        const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y < totalHeight; y += viewportHeight) {
            window.scrollTo({ top: y, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await sleep(STEP_DELAY_MS);
            const found = this.find(selectors);
            if (found) return found;
        }
        return this.find(selectors);
    }

    /** The container's visible rows, read with the list's saved `fields` so every page has the same columns. */
    private containerRows(element: HTMLElement, type: 'table' | 'list', fields?: unknown): { type: string; items: any[]; columns: any[] } {
        const rowsContainer = /^(TABLE|THEAD|TFOOT)$/.test(element.tagName) ? element.querySelector('tbody') ?? element : element;
        const rowElements = (Array.from(rowsContainer.children) as HTMLElement[]).filter(child => {
            if (child.tagName === 'THEAD') return false;
            const style = window.getComputedStyle(child);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            return (child.innerText || child.textContent || '').trim().length > 0;
        });
        if (rowElements.length === 0) return { type, items: [], columns: [] };
        const { columns, items } = this.extractor.extractRows(rowElements, fields);
        return { type, items, columns };
    }
}

/** How a click step went: done, not needed, done by following the control's markup, or nothing happened. */
export type ClickStep = 'clicked' | 'already-open' | 'opened' | 'no-effect';

/** A change made by our own highlight (its overlay, its style), not the page's answer to a click. */
function isOurs(m: MutationRecord): boolean {
    const ours = (n: Node) => n instanceof Element && (n.hasAttribute('data-crawlpilot-overlay') || n.id === 'crawlpilot-extraction-highlight-styles' || !!n.closest('[data-crawlpilot-overlay]'));
    if (ours(m.target)) return true;
    const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
    return m.type === 'childList' && nodes.length > 0 && nodes.every(ours);
}

function isOpen(control: Element): boolean {
    if (control.tagName === 'SUMMARY') return !!control.parentElement?.hasAttribute('open');
    return control.getAttribute('aria-expanded') === 'true' || control.getAttribute('aria-selected') === 'true';
}

function stateOf(control: Element): string {
    return [control.getAttribute('aria-expanded'), control.getAttribute('aria-selected'), control.parentElement?.hasAttribute('open'), location.href].join('|');
}

/** Opens what the control says it controls; true when there was something to open. */
function openByMarkup(control: HTMLElement): boolean {
    if (control.tagName === 'SUMMARY' && control.parentElement?.tagName === 'DETAILS') {
        control.parentElement.setAttribute('open', '');
        return true;
    }
    const ids = (control.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    const panels = ids.map(id => document.getElementById(id)).filter((p): p is HTMLElement => !!p);
    panels.forEach(p => {
        p.hidden = false;
        p.removeAttribute('aria-hidden');
        if (getComputedStyle(p).display === 'none') p.style.setProperty('display', 'block', 'important');
        if (getComputedStyle(p).visibility === 'hidden') p.style.setProperty('visibility', 'visible', 'important');
    });
    if (panels.length > 0 && control.hasAttribute('aria-expanded')) control.setAttribute('aria-expanded', 'true');
    return panels.length > 0;
}
