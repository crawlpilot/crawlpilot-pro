import { ElementDefinition, ExtractionConfig, ProcessedElementResult, ExtractionResult } from '../types';
import { ContainerDetector } from '../../../features/picker/ContainerDetector';
import { DataExtractor } from '../../../services/extraction/DataExtractor';

export class ElementProcessor {
    private detector: ContainerDetector;
    private extractor: DataExtractor;

    constructor(private config: ExtractionConfig) {
        this.detector = new ContainerDetector();
        this.extractor = new DataExtractor();
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

            await this.highlightElement(foundElement.element);

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

    private async highlightElement(element: HTMLElement): Promise<void> {
        const duration = this.config?.elementHighlightDuration || 1000;

        const originalOutline = element.style.outline;
        const originalBg = element.style.backgroundColor;

        element.style.outline = '2px solid #22D3EE'; // Theme Accent Blue
        element.style.backgroundColor = 'rgba(34, 211, 238, 0.2)'; // Theme Accent Blue transparent

        return new Promise(resolve => {
            setTimeout(() => {
                element.style.outline = originalOutline;
                element.style.backgroundColor = originalBg;
                resolve();
            }, duration);
        });
    }

    private async performAction(elementDef: ElementDefinition, element: HTMLElement): Promise<ExtractionResult> {
        // Handle scrolling if explicitly requested or implicitly needed?
        // Legacy 'clickElement' did scrollIntoView. We should do it for interactions.
        if (elementDef.action === 'click') {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 500)); // Wait for scroll
            return this.performClickAction(elementDef, element);
        } else if (elementDef.action === 'extract') {
            // For extraction, we might not need to scroll unless it's lazy loaded?
            // To be safe and robust (like user asked), let's scroll if it's way off screen?
            // But maybe distracting. Let's stick to click having scroll.
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
            case 'list':
                // Smart List / Smart Single Extraction
                {
                    const containerInfo = this.detector.findInternalContainer(element);
                    const extractedData = this.extractor.extract(element, containerInfo);

                    if (extractedData && extractedData.items && extractedData.items.length > 0) {
                        return {
                            success: true,
                            data: extractedData,
                            columns: extractedData.columns
                        };
                    } else {
                        value = element.innerText || element.textContent;
                    }
                }
                break;

            case 'table': {
                // Table Extraction — same pipeline as list, but tagged 'table' so the
                // Aggregator explodes rows. Each sibling child = one row with N columns.
                const containerInfo = this.detector.findInternalContainer(element);
                const extractedData = this.extractor.extract(element, containerInfo);

                if (extractedData && extractedData.items && extractedData.items.length > 0) {
                    return {
                        success: true,
                        data: { ...extractedData, type: 'table' },
                        columns: extractedData.columns
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
            // Enhanced click with wait
            element.click();

            // Wait time from config or default
            const waitTime = _elementDef.waitTimeAfterClick || 500;
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
}
