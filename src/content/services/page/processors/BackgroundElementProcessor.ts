/**
 * BackgroundElementProcessor — a lightweight variant of ElementProcessor
 * optimized for background/non-visible tab extraction.
 * 
 * Key differences from ElementProcessor:
 * - No scrollIntoView (tabs may be minimized/background)
 * - Highlights are fire-and-forget (non-blocking)
 * - Direct DOM query + data extraction only
 * - Faster execution (no scroll/highlight waits)
 * 
 * Reuses the same DataExtractor and SchemaGenerator for data extraction logic.
 */

import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { SchemaGenerator } from '../../../services/extraction/SchemaGenerator';
import { clickElementRobust } from '../../../services/dom/domUtils';
import { resolveFirst } from '../../../../shared/selectors/resolve';

export class BackgroundElementProcessor {
    private extractor: DataExtractor;
    private schemaGenerator: SchemaGenerator;
    constructor(private config: ExtractionConfig) {
        this.extractor = new DataExtractor();
        this.schemaGenerator = new SchemaGenerator();
    }

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

            // Fast-path: element already in DOM
            let foundElement = this.findElement(elementDef.selectors, elementDef.name);

            // Fallback: scroll full page to trigger lazy loaders, returns element if found
            if (!foundElement.success || !foundElement.element) {
                const revealed = await this.scrollPageToReveal(elementDef.selectors, elementDef.name);
                foundElement = revealed
                    ? { success: true, element: revealed }
                    : { success: false, error: `Element "${elementDef.name}" not found after full page scroll` };
            }

            if (!foundElement.success || !foundElement.element) {
                result.error = foundElement.error || 'Element not found';
                return result;
            }

            this.highlightElement(foundElement.element, elementDef.name);

            // Scroll element into view — synchronous, no waits
            this.scrollIntoViewAndWait(foundElement.element);

            const actionResult = await this.performAction(elementDef, foundElement.element);

            if (actionResult.success) {
                result.success = true;
                result.data = actionResult.data;
                result.columns = this.extractColumns(elementDef, actionResult);
            } else {
                result.error = actionResult.error;
            }

            return result;
        } catch (error: any) {
            result.error = error.message;
            return result;
        }
    }

    private highlightElement(element: HTMLElement, elementName?: string): void {
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

    private waitForElement(selectors: any[], timeout: number): Promise<void> {
        return new Promise((resolve) => {
            const check = (): boolean => resolveFirst(selectors, document).element !== null;

            if (check()) { resolve(); return; }

            const deadline = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
            const observer = new MutationObserver(() => {
                if (check()) {
                    clearTimeout(deadline);
                    observer.disconnect();
                    resolve();
                }
            });
            const target = document.body || document.documentElement;
            observer.observe(target, { childList: true, subtree: true });
        });
    }

    private findElement(selectors: any[], elementName: string): { success: boolean; element?: HTMLElement; error?: string } {
        const { element } = resolveFirst(selectors, document);
        if (element) {
            return { success: true, element: element as HTMLElement };
        }
        return { success: false, error: `Could not find element "${elementName}"` };
    }

    private async performAction(elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        if (elementDef.action === 'click') {
            return this.performClickAction(elementDef, element);
        }
        return this.performExtractAction(elementDef, element);
    }

    private async performExtractAction(elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        const type = elementDef.type || 'text';
        let value: string | null = null;

        switch (type) {
            case 'text':
                value = (element as any).value || element.innerText || element.textContent;
                break;
            case 'link_url':
            case 'link':
                if (element.tagName === 'A') {
                    value = (element as HTMLAnchorElement).href;
                } else {
                    value = element.getAttribute('href') || element.innerText;
                }
                break;
            case 'image_url':
            case 'image':
                if (element.tagName === 'IMG') {
                    value = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src;
                } else {
                    const style = window.getComputedStyle(element);
                    if (style.backgroundImage && style.backgroundImage !== 'none') {
                        value = style.backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
                    } else {
                        value = element.getAttribute('src') || element.getAttribute('data-src');
                    }
                }
                break;
            case 'image_array': {
                const imgs = Array.from(element.querySelectorAll('img')) as HTMLImageElement[];
                return { success: true, data: { [elementDef.id]: imgs.map(img => img.currentSrc || img.src).filter(Boolean) } };
            }
            case 'link_array': {
                const anchors = Array.from(element.querySelectorAll('a[href]')) as HTMLAnchorElement[];
                return { success: true, data: { [elementDef.id]: anchors.map(a => a.href).filter(v => v && !v.startsWith('javascript:')) } };
            }
            case 'text_array': {
                const skipTags = new Set(['BR', 'HR', 'SCRIPT', 'STYLE', 'LINK', 'META']);
                const kids = Array.from(element.children).filter(c => !skipTags.has(c.tagName)) as HTMLElement[];
                return { success: true, data: { [elementDef.id]: kids.map(c => (c.textContent || '').trim()).filter(Boolean) } };
            }
            case 'smart':
            case 'list': {
                const listData = this.extractContainerRows(element, 'list');
                if (listData.items && listData.items.length > 0) {
                    return { success: true, data: listData, columns: listData.columns };
                }
                value = element.innerText || element.textContent;
                break;
            }
            case 'table': {
                const tableData = this.extractContainerRows(element, 'table');
                if (tableData.items && tableData.items.length > 0) {
                    const json = this.collapseTableToJson(tableData.items, tableData.columns);
                    const tableResult: any = {
                        success: true,
                        data: {
                            [elementDef.id]: json,
                            [elementDef.id + '__tabledata']: JSON.stringify({ items: tableData.items, columns: tableData.columns })
                        },
                        _columnCount: tableData.columns.length
                    };
                    return tableResult;
                }
                value = element.innerText || element.textContent;
                break;
            }
            default:
                value = element.innerText;
        }

        if (value) value = value.trim();

        // Key data by element ID so it matches the column definition
        return { success: true, data: { [elementDef.id]: value } };
    }

    private async performClickAction(_elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        try {
            // queueMicrotask-based click — yields between phases without setTimeout,
            // so background-tab throttling does not apply. Post-click delay handled at SW level.
            await clickElementRobust(element);
            return { success: true, data: { value: 'clicked', action: 'click' } };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    // Scroll the full page to trigger IntersectionObserver lazy loaders.
    // Uses per-step delays so callbacks have time to fire between viewport advances.
    private async scrollPageToReveal(targetSelectors?: any[], targetName?: string): Promise<HTMLElement | null> {
        const viewportHeight = window.innerHeight || 800;
        const STEP_DELAY_MS = 600;  // clamped to ~1000ms in inactive background tabs
        const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        for (let y = 0; y < totalHeight; y += viewportHeight) {
            window.scrollTo({ top: y, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, STEP_DELAY_MS));
            if (targetSelectors) {
                const found = this.findElement(targetSelectors, targetName || '');
                if (found.success && found.element) return found.element;
            }
        }
        if (targetSelectors) {
            return this.findElement(targetSelectors, targetName || '').element ?? null;
        }
        return null;
    }

    // Scroll element into viewport — synchronous, no setTimeout waits.
    private scrollIntoViewAndWait(element: HTMLElement): void {
        element.scrollIntoView({ behavior: 'instant', block: 'center' });
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));
    }

    private extractColumns(elementDef: ElementDefinition, actionResult: ExtractionResult): any[] {
        if (elementDef.type === 'table' && (actionResult as any)._columnCount !== undefined) {
            const groupId = elementDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            const columnCount = (actionResult as any)._columnCount;
            return [
                {
                    id: elementDef.id,
                    originalId: elementDef.id,
                    name: elementDef.name,
                    type: 'json',
                    elementId: elementDef.id,
                    elementName: elementDef.name,
                    group: { id: groupId, name: elementDef.name },
                    isKeyValue: columnCount === 2,
                    columnCount
                },
                {
                    id: elementDef.id + '__tabledata',
                    originalId: elementDef.id + '__tabledata',
                    name: elementDef.name + ' (raw)',
                    type: 'tabledata',
                    hidden: true,
                    elementId: elementDef.id,
                    elementName: elementDef.name
                }
            ];
        }

        const isListOrSmart = elementDef.type === 'list' || elementDef.type === 'smart';

        if (actionResult.columns) {
            const cols = actionResult.columns;
            const groupId = elementDef.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            const isKeyValue = isListOrSmart && cols.length === 2;

            return cols.map(col => ({
                ...col,
                elementId: elementDef.id,
                elementName: elementDef.name,
                ...(isListOrSmart ? {
                    group: { id: groupId, name: elementDef.name },
                    name: `${elementDef.name} - ${col.name}`,
                    ...(isKeyValue ? { isKeyValue: true } : {})
                } : {})
            }));
        }

        return [{
            id: elementDef.id,
            originalId: elementDef.id,
            name: elementDef.name,
            type: elementDef.type || 'text',
            elementId: elementDef.id,
            elementName: elementDef.name
        }];
    }

    private collapseTableToJson(items: any[], columns: any[]): string {
        const cols = columns || [];
        if (cols.length === 0 || items.length === 0) return '[]';

        const rowValues = items.map(row =>
            cols.map(col => row[col.id]).filter(v => v != null && String(v).trim() !== '')
        );

        if (cols.length === 1) {
            return JSON.stringify(rowValues.flat());
        }

        return JSON.stringify(rowValues.filter(vals => vals.length > 0));
    }

    private extractContainerRows(element: HTMLElement, _type: 'table' | 'list'): any {
        let rowsContainer: HTMLElement = element;
        if (element.tagName === 'TABLE' || element.tagName === 'THEAD' || element.tagName === 'TFOOT') {
            const tbody = element.querySelector('tbody');
            if (tbody) rowsContainer = tbody as HTMLElement;
        }

        const childNodes = Array.from(rowsContainer.children) as HTMLElement[];
        const rowElements = childNodes.filter(child => {
            if (child.tagName === 'THEAD') return false;
            const style = window.getComputedStyle(child);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const text = (child.innerText || child.textContent || '').trim();
            return text.length > 0;
        });

        if (rowElements.length === 0) {
            return { items: [], columns: [] };
        }

        // Use DataExtractor for row parsing
        const rawRows: any[] = [];

        for (const row of rowElements) {
            const rowData = this.extractor.extractRow(row);
            if (rowData && Object.keys(rowData).length > 0) {
                rawRows.push(rowData);
            }
        }

        if (rawRows.length === 0) {
            return { items: [], columns: [] };
        }

        // Generate schema and normalize data to use hashed column IDs
        const { columns } = this.schemaGenerator.generateSchema(rawRows);
        const items = this.extractor.normalizeData(rawRows, columns);

        return { items, columns, type: _type };
    }
}
