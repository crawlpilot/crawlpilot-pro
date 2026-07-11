import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { SchemaGenerator } from '../../../services/extraction/SchemaGenerator';
import { resolveFirst } from '../../../../shared/selectors/resolve';

export class ElementProcessor {
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
            // Step 1: Fast-path find — element is already in DOM
            let foundElement = await this.findView(elementDef.selectors, elementDef.name);

            // Step 2: Fallback — element not yet in DOM (lazy-loaded).
            // Scroll the page progressively to trigger IntersectionObserver-based loaders,
            // then retry the query.
            if (!foundElement.success || !foundElement.element) {
                await this.scrollPageToReveal();
                foundElement = await this.findView(elementDef.selectors, elementDef.name);
            }

            if (!foundElement.success || !foundElement.element) {
                result.error = foundElement.error || 'Element not found';
                return result;
            }

            // Step 3: Scroll element into view (instant — reliable in background tabs)
            // and wait for any lazy content it contains to finish loading.
            await this.scrollIntoViewAndWait(foundElement.element);

            await this.highlightElement(foundElement.element, elementDef.name);

            const actionResult = await this.performAction(elementDef, foundElement.element);

            if (actionResult.success) {
                result.success = true;
                result.data = actionResult.data;
                // Only extract columns if extracting, not clicking? 
                // Legacy wrapper logic suggests click might return success but no data columns unless configured
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

    private async findView(selectors: any[], elementName: string): Promise<{ success: boolean; element?: HTMLElement; error?: string; selector?: string }> {
        const { element, used } = resolveFirst(selectors, document);
        if (element) {
            return { success: true, element: element as HTMLElement, selector: used?.value };
        }
        return { success: false, error: `Could not find element "${elementName}"` };
    }

    /**
     * Scrolls the page in viewport-sized chunks to trigger IntersectionObserver-based
     * lazy loaders. Called only when findView() returns nothing (element not yet in DOM).
     * Uses `instant` scroll + explicit `scroll` event dispatch — both are required because
     * background tabs often skip smooth animation and may not fire scroll events on their own.
     */
    private async scrollPageToReveal(): Promise<void> {
        const viewportHeight = window.innerHeight || 800;
        const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

        for (let y = 0; y < totalHeight; y += viewportHeight) {
            window.scrollTo({ top: y, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, 150));
        }
        // Final pause for any triggered network fetches / renders
        await new Promise(r => setTimeout(r, 400));
    }

    /**
     * Scrolls an element to the center of the viewport using `instant` (reliable in
     * background tabs), dispatches scroll events to wake IntersectionObserver loaders,
     * waits for content to render, and verifies the element has non-zero dimensions.
     */
    private async scrollIntoViewAndWait(element: HTMLElement): Promise<void> {
        element.scrollIntoView({ behavior: 'instant', block: 'center' });
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));

        const baseWait = Math.max(600, this.config?.actionSpeed || 500);
        await new Promise(r => setTimeout(r, baseWait));

        // If the element still has no dimensions, the browser may not have committed the
        // scroll (common in background tabs). Fall back to window.scrollTo directly.
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            const absoluteTop = rect.top + window.scrollY;
            window.scrollTo({ top: Math.max(0, absoluteTop - window.innerHeight / 2), behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise(r => setTimeout(r, 400));
        }
    }

    private async highlightElement(element: HTMLElement, elementName?: string): Promise<void> {
        const duration = this.config?.actionSpeed || this.config?.elementHighlightDuration || 500;
        const shouldHighlight = this.config?.showExtractionHighlights !== false;
        if (!shouldHighlight) return;

        // Inject keyframes if not already present
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

        // Create a fixed-position overlay (non-intrusive, doesn't modify original element styles)
        const rect = element.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'crawlpilot-extraction-highlight';
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

        // Label badge showing element name
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
                box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
                white-space: nowrap !important;
            `;
            overlay.appendChild(label);
        }

        document.documentElement.appendChild(overlay);

        return new Promise(resolve => {
            setTimeout(() => {
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.3s ease';
                setTimeout(() => { overlay.remove(); resolve(); }, 300);
            }, duration);
        });
    }

    private async performAction(elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        if (elementDef.action === 'click') {
            return this.performClickAction(elementDef, element);
        } else if (elementDef.action === 'extract') {
            return this.performExtractAction(elementDef, element);
        }

        throw new Error(`Unsupported action: ${elementDef.action}`);
    }

    private async performExtractAction(elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        // Detailed extraction types based on legacy background-readable.js analysis
        // supported types: smart, text, image_url, image_background, link_url

        const type = elementDef.type || 'text';
        let value: string | null = null;
        let data: any = {};

        switch (type) {
            case 'text':
                value = (element as any).value || element.innerText || element.textContent;
                break;
            case 'link_url':
            case 'link':
                if (element.tagName === 'A') {
                    value = (element as HTMLAnchorElement).href;
                } else {
                    // Try to find closest A? or just get text?
                    // Legacy fallback might be just text or empty
                    value = element.getAttribute('href') || element.innerText;
                }
                break;
            case 'image_url':
            case 'image':
                if (element.tagName === 'IMG') {
                    value = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src;
                } else {
                    // check background image?
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
                // List Extraction: extract all rows from the container directly.
                const listData = this.extractContainerRows(element, 'list');
                if (listData.items && listData.items.length > 0) {
                    return {
                        success: true,
                        data: listData,
                        columns: listData.columns
                    };
                } else {
                    value = element.innerText || element.textContent;
                }
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

        if (value) {
            value = value.trim();
        }

        return {
            success: true,
            data: { value, ...data }
        };
    }

    private async performClickAction(_elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        try {
            // Full mouse event sequence for maximum compatibility with SPAs,
            // framework event handlers, and accordion/dropdown components
            const events: string[] = ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'focus', 'mouseup', 'click'];
            for (const eventType of events) {
                element.dispatchEvent(new MouseEvent(eventType, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0
                }));
            }

            // Also try native click as fallback (some frameworks only listen to this)
            element.click();

            // For inputs/selects, trigger focus and change events
            if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
                element.focus();
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Wait for expansion/animation to complete.
            // clickWaitMs (from orchestrator config) takes priority so accordion/tab
            // animations have time to finish before the next element is processed.
            const waitTime = _elementDef.waitTimeAfterClick
                || this.config?.clickWaitMs
                || this.config?.actionSpeed
                || 1000;
            await new Promise(r => setTimeout(r, waitTime));

            return {
                success: true,
                data: {
                    value: 'clicked',
                    action: 'click',
                    waitTimeApplied: waitTime
                }
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    private extractColumns(elementDef: ElementDefinition, actionResult: ExtractionResult): any[] {
        // Table elements are JSON-consolidated: one visible JSON column + one hidden raw-data column
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

    /**
     * Directly extracts all row-level children from a container element.
     * Handles nested <table> → <tbody> → <tr> DOM structure automatically.
     * This bypasses unreliable re-detection (findInternalContainer) which only ever
     * returns the first match from querySelector.
     */
    private extractContainerRows(element: HTMLElement, type: 'table' | 'list'): any {
        // For <table> elements, dive into <tbody> to get <tr> children
        let rowsContainer: HTMLElement = element;
        if (element.tagName === 'TABLE' || element.tagName === 'THEAD' || element.tagName === 'TFOOT') {
            const tbody = element.querySelector('tbody');
            if (tbody) rowsContainer = tbody as HTMLElement;
        }

        // Collect all direct meaningful children
        const childNodes = Array.from(rowsContainer.children) as HTMLElement[];
        const rowElements = childNodes.filter(child => {
            // Skip header rows in tbody if present
            if (child.tagName === 'THEAD') return false;
            // Skip hidden elements
            const style = window.getComputedStyle(child);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            // Must have some text content
            const text = (child.innerText || child.textContent || '').trim();
            return text.length > 0;
        });

        if (rowElements.length === 0) {
            // Last resort: grab all li/tr/div children anywhere in the element
            const fallbackRows = Array.from(
                element.querySelectorAll('li, tr, [class*="item"], [class*="row"]')
            ).filter((el, _idx, arr) => {
                // Only top-level occurrences relative to their parent
                const parent = el.parentElement;
                return parent && arr.filter(e => e.parentElement === parent).length > 1;
            }) as HTMLElement[];

            if (fallbackRows.length === 0) {
                return { type, items: [], columns: [] };
            }

            return this.buildRowsResult(fallbackRows, type);
        }

        return this.buildRowsResult(rowElements, type);
    }

    private buildRowsResult(rowElements: HTMLElement[], type: 'table' | 'list'): any {
        const seenHashes = new Set<string>();
        const rawRows: any[] = [];

        for (const row of rowElements) {
            const rowData = this.extractor.extractRow(row);
            const hash = JSON.stringify(rowData);
            if (!seenHashes.has(hash) && Object.keys(rowData).length > 0) {
                seenHashes.add(hash);
                rawRows.push(rowData);
            }
        }

        if (rawRows.length === 0) {
            return { type, items: [], columns: [] };
        }

        const schemaResult = this.schemaGenerator.generateSchema(rawRows);
        const items = this.extractor.normalizeData(rawRows, schemaResult.columns);

        return {
            type,
            items,
            columns: schemaResult.columns,
            count: items.length
        };
    }
}
