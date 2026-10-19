/**
 * Finds one Page Extractor element on the page and extracts (or clicks) it. Runs in tabs that are
 * often in the background, so nothing waits on timers that hidden tabs throttle: highlights are
 * fire-and-forget, scrolling is instant, and clicks yield with microtasks (the post-click wait
 * happens in the service worker).
 */
import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { DataExtractor } from '../../extraction/DataExtractor';
import { readValue } from '../../extraction/atoms';
import { clickElementRobust } from '../../../utils/click';
import { resolveOne } from '../../../../shared/selectors/resolve';
import { extractColumns, collapseTableToJson } from './columnHelpers';

export class ElementProcessor {
    private extractor = new DataExtractor();

    constructor(private config: ExtractionConfig) { }

    async processElement(elementDef: ElementDefinition): Promise<ProcessedElementResult> {
        const result: ProcessedElementResult = {
            elementId: elementDef.id,
            elementName: elementDef.name,
            success: false,
            error: null,
            data: null,
            columns: []
        };

        try {
            if (this.config?.waitForElements) {
                const timeout = this.config.elementTimeout > 0 ? this.config.elementTimeout : 5000;
                await this.waitForElement(elementDef.selectors, timeout);
            }

            // Not in the DOM yet: scroll the page to wake lazy loaders.
            const element = this.find(elementDef.selectors) ?? await this.scrollPageToReveal(elementDef.selectors);
            if (!element) {
                result.error = `Element "${elementDef.name}" not found after full page scroll`;
                return result;
            }

            this.highlight(element, elementDef.name);
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
            window.dispatchEvent(new Event('scroll'));
            document.dispatchEvent(new Event('scroll'));

            const actionResult = elementDef.action === 'click'
                ? await this.click(element)
                : this.extract(elementDef, element);

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

    private waitForElement(selectors: string[], timeout: number): Promise<void> {
        return new Promise((resolve) => {
            if (this.find(selectors)) { resolve(); return; }

            const deadline = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
            const observer = new MutationObserver(() => {
                if (this.find(selectors)) {
                    clearTimeout(deadline);
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        });
    }

    private extract(elementDef: ElementDefinition, element: HTMLElement): ExtractionResult {
        const type = elementDef.type || 'text';
        let value: string | null = null;

        switch (type) {
            case 'text':
                value = (element as any).value || element.innerText || element.textContent;
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
                const skipTags = new Set(['BR', 'HR', 'SCRIPT', 'STYLE', 'LINK', 'META']);
                const kids = Array.from(element.children).filter(c => !skipTags.has(c.tagName));
                return { success: true, data: { [elementDef.id]: kids.map(c => (c.textContent || '').trim()).filter(Boolean) } };
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

    private async click(element: HTMLElement): Promise<ExtractionResult> {
        try {
            await clickElementRobust(element);
            return { success: true, data: { value: 'clicked', action: 'click' } };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /** Scrolls the whole page a viewport at a time (so lazy loaders fire), looking for the element at each step. */
    private async scrollPageToReveal(selectors: string[]): Promise<HTMLElement | null> {
        const viewportHeight = window.innerHeight || 800;
        const STEP_DELAY_MS = 600;  // clamped to ~1000ms in inactive background tabs
        const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y < totalHeight; y += viewportHeight) {
            window.scrollTo({ top: y, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, STEP_DELAY_MS));
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
