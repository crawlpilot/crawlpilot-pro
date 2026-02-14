import { IExtractionStrategy, ExtractionConfig, RowData } from './IExtractionStrategy';
import { AttributeSelectorGenerator } from '../../../services/dom/selectors/AttributeSelectorGenerator';

/**
 * CSS Selector Extraction Strategy
 * Uses css-selector-generator to create robust, semantic CSS selectors as keys
 */
export class CSSSelectorExtractionStrategy implements IExtractionStrategy {
    private selectorGenerator = new AttributeSelectorGenerator();

    extract(element: HTMLElement, config: ExtractionConfig): RowData {
        const results: Record<string, any> = {};

        // Traverse and extract with CSS selectors
        this.processNode(element, config.containerRoot, results);

        return {
            data: results,
            metadata: {
                selector: 'css-selector',
                timestamp: new Date().toISOString()
            }
        };
    }

    private processNode(element: HTMLElement, root: HTMLElement, results: Record<string, any>) {
        if (!element || !element.tagName || ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(element.tagName)) return;
        if (element.offsetParent === null) return; // Skip hidden elements

        // Generate CSS selector as key
        const identifier = this.selectorGenerator.generateAttributeSelector(element, root);
        const selectorKey = identifier.selector;

        // 1. Extract direct text content
        const directText = this.extractDirectText(element);
        if (directText && (directText.length > 1 || /\d/.test(directText))) {
            results[selectorKey] = directText;
        }

        // 2. Extract link href
        if (element.tagName === 'A') {
            const href = element.getAttribute('href');
            if (href && !href.trim().toLowerCase().startsWith('javascript:') && !href.startsWith('#')) {
                results[`${selectorKey} href`] = this.normalizeUrl(href.trim());
            }
        }

        // 3. Extract image src and alt
        if (element.tagName === 'IMG') {
            let src = element.getAttribute('src') ||
                element.getAttribute('data-src') ||
                element.getAttribute('data-lazy-src');

            if (src && !src.startsWith('data:')) {
                results[`${selectorKey} src`] = this.normalizeUrl(src.trim());
            }

            const alt = element.getAttribute('alt');
            if (alt && alt.trim()) {
                results[`${selectorKey} alt`] = alt.trim();
            }
        }

        // 4. Recurse children
        Array.from(element.children).forEach(child => {
            this.processNode(child as HTMLElement, root, results);
        });
    }

    private extractDirectText(element: HTMLElement): string {
        try {
            return Array.from(element.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent?.trim())
                .filter(Boolean)
                .join(' ');
        } catch {
            return '';
        }
    }

    private normalizeUrl(url: string): string {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('//')) return `${window.location.protocol}${url}`;

        const { protocol, host, pathname } = window.location;
        const origin = `${protocol}//${host}`;

        if (url.startsWith('/')) return `${origin}${url}`;

        const pathParts = pathname.split('/').filter(Boolean);
        pathParts.pop();
        return `${origin}${pathParts.length > 0 ? `/${pathParts.join('/')}/` : '/'}${url}`;
    }

    getName(): string {
        return 'css-selector';
    }
}
