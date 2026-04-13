import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { SchemaGenerator } from '../../../services/extraction/SchemaGenerator';

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
            const foundElement = await this.findView(elementDef.selectors, elementDef.name);

            if (!foundElement.success || !foundElement.element) {
                result.error = foundElement.error || 'Element not found';
                return result;
            }

            // Scroll element into viewport using native scrollIntoView (reliable)
            foundElement.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Wait for scroll animation to complete (smooth scroll can take 500ms+)
            const scrollWait = Math.max(500, (this.config?.actionSpeed || 500));
            await new Promise(r => setTimeout(r, scrollWait));

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
        for (const selector of selectors) {
            try {
                let element: HTMLElement | null = null;

                if (selector.type === 'xpath') {
                    const result = document.evaluate(selector.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    element = result.singleNodeValue as HTMLElement;
                } else {
                    element = document.querySelector(selector.value) as HTMLElement;
                }

                if (element) {
                    return { success: true, element, selector: selector.value };
                }
            } catch (e) {
                console.warn(`Failed to query selector ${selector.value} for ${elementName}:`, e);
            }
        }

        return { success: false, error: `Could not find element "${elementName}"` };
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
                // Table Extraction: extract rows directly from the container element.
                // We bypass findInternalContainer() re-detection because it misidentifies levels
                // (e.g., <table> has <tbody> children, not <tr> directly).
                // Instead we directly enumerate all meaningful child elements.
                const tableData = this.extractContainerRows(element, 'table');
                if (tableData.items && tableData.items.length > 0) {
                    return {
                        success: true,
                        data: tableData,
                        columns: tableData.columns
                    };
                }
                // Fallback
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

            // Wait for expansion/animation to complete
            const waitTime = _elementDef.waitTimeAfterClick || this.config?.actionSpeed || 500;
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
        if (actionResult.columns) {
            return actionResult.columns.map(col => ({
                ...col,
                elementId: elementDef.id,
                elementName: elementDef.name
            }));
        }

        // Return a column definition for the extracted data
        return [{
            id: elementDef.id,
            originalId: elementDef.id,
            name: elementDef.name,
            type: elementDef.type || 'text',
            elementId: elementDef.id,
            elementName: elementDef.name
        }];
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
