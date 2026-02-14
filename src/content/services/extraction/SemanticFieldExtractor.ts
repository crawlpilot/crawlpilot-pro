/* eslint-disable @typescript-eslint/no-explicit-any */
import { VisualFeatureExtractor, type VisualFeatures } from './VisualFeatureExtractor';

/**
 * SemanticFieldExtractor
 * Extracts semantic fields with confidence scoring using zero hardcoded selectors.
 * Based on algorithms from background-readable.js + LayoutLMv3-inspired visual features
 */

export type FieldType =
    | 'title'
    | 'price'
    | 'image'
    | 'link'
    | 'date'
    | 'rating'
    | 'description'
    | 'author';

export interface SemanticField {
    fieldType: FieldType;
    value: any;
    confidence: number;
}

export interface ExtractionResult {
    fields: Record<string, any>;
    confidence: Record<string, number>;
    metadata: {
        nodeCount: number;
        extractedFields: number;
    };
}

export class SemanticFieldExtractor {
    private visualExtractor = new VisualFeatureExtractor();

    /**
     * Extract semantic fields from an element with confidence scores
     */
    public extractFields(itemElement: HTMLElement): ExtractionResult {
        const fields: Record<string, any> = {};
        const confidence: Record<string, number> = {};

        // Traverse entire subtree
        const allNodes = this.getAllNodes(itemElement);

        let detectedCount = 0;
        let filteredCount = 0;

        for (const node of allNodes) {
            const semantics = this.inferSemantics(node);

            if (semantics.confidence > 0.3) { // Lowered from 0.5
                detectedCount++;
                const key = semantics.fieldType;

                // Only keep highest confidence for each field type
                if (!confidence[key] || confidence[key] < semantics.confidence) {
                    fields[key] = semantics.value;
                    confidence[key] = semantics.confidence;
                }
            } else if (semantics.confidence > 0) {
                filteredCount++;
            }
        }

        // Only log summary on final extraction
        if (Object.keys(fields).length > 0) {
            console.log('📋 Semantic extraction result:', {
                fields,
                confidence,
                nodeCount: allNodes.length,
                extractedFields: Object.keys(fields).length
            });
        }

        return {
            fields,
            confidence,
            metadata: {
                nodeCount: allNodes.length,
                extractedFields: Object.keys(fields).length
            }
        };
    }

    /**
     * Get all nodes in subtree (DFS)
     */
    private getAllNodes(root: HTMLElement): Node[] {
        const nodes: Node[] = [];
        const stack: Node[] = [root];

        while (stack.length > 0) {
            const node = stack.pop()!;
            nodes.push(node);

            if (node.childNodes) {
                for (let i = node.childNodes.length - 1; i >= 0; i--) {
                    stack.push(node.childNodes[i]);
                }
            }
        }

        return nodes;
    }

    /**
     * Safely get className as string (handles SVG elements where className is an object)
     */
    private getClassNameString(element: Element): string {
        const className = element.className;
        // SVG elements have className as SVGAnimatedString
        if (typeof className === 'string') {
            return className;
        } else if (className && typeof className === 'object' && 'baseVal' in className) {
            return (className as any).baseVal || '';
        }
        return '';
    }

    /**
     * Infer semantic meaning from a node
     */
    private inferSemantics(node: Node): SemanticField {
        const results: SemanticField[] = [];

        // Extract visual features if it's an element
        let visual: VisualFeatures | null = null;
        if (node.nodeType === Node.ELEMENT_NODE) {
            visual = this.visualExtractor.extract(node as Element);
        }

        // Try each semantic detector
        results.push(this.detectTitle(node, visual));
        results.push(this.detectPrice(node, visual));
        results.push(this.detectImage(node));
        results.push(this.detectLink(node));
        results.push(this.detectDate(node));
        results.push(this.detectRating(node));
        results.push(this.detectDescription(node));
        results.push(this.detectAuthor(node));

        // Return highest confidence result
        return results.reduce((best, current) =>
            current.confidence > best.confidence ? current : best
        );
    }

    /**
     * Detect title fields (headings, large fonts, semantic attributes)
     * Enhanced with visual prominence scoring
     */
    private detectTitle(node: Node, visual: VisualFeatures | null): SemanticField {
        let confidence = 0;
        let value = null;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return { fieldType: 'title', value, confidence };
        }

        const element = node as HTMLElement;

        // Heading tags - highest confidence
        if (/^H[1-6]$/.test(element.tagName)) {
            confidence = 0.9;
            value = element.textContent?.trim();
        }
        // Visual prominence boost (large, bold text = likely title)
        else if (visual && visual.prominenceScore > 0.6) {
            confidence = 0.7;
            value = element.textContent?.trim();
        }
        // Large font size fallback
        else if (element.textContent) {
            try {
                const fontSize = parseFloat(window.getComputedStyle(element).fontSize);
                const text = element.textContent.trim();

                if (fontSize >= 20 && text.length > 3 && text.length < 200) {
                    confidence = 0.7;
                    value = text;
                }
            } catch (e) {
                // Ignore style access errors
            }
        }

        // Semantic attributes boost
        if (element.getAttribute) {
            const attrs = ['title', 'heading', 'name', 'product-name'];
            const className = this.getClassNameString(element).toLowerCase();
            for (const attr of attrs) {
                if (element.getAttribute(`data-${attr}`) || className.includes(attr)) {
                    confidence = Math.max(confidence, 0.6);
                    value = value || element.textContent?.trim();
                }
            }
        }

        return { fieldType: 'title', value, confidence };
    }

    /**
     * Detect price fields (currency symbols, patterns)
     * Enhanced with visual highlighting and strikethrough detection
     */
    private detectPrice(node: Node, visual: VisualFeatures | null): SemanticField {
        let confidence = 0;
        let value = null;

        const text = node.textContent || '';

        // Enhanced price patterns for better matching
        const pricePatterns = [
            /\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,  // $1,234.56
            /\$\s*(\d+)/,                           // $649 (without cents)
            /€\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
            /£\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
            /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
            /¥\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
            /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*USD/i,
            /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*EUR/i,
            // Walmart-specific: "current price" followed by amount
            /current\s+price[^\d]*(\$\d+\.\d{2})/i,
            // Just numbers with decimal (if near price-related text)
            /(\d+\.\d{2})/  // Last resort: any decimal number
        ];

        for (const pattern of pricePatterns) {
            const match = text.match(pattern);
            if (match) {
                confidence = 0.95;
                value = match[0];
                break;
            }
        }

        // Visual feature boosts
        if (visual && value) {
            // Highlighted background = likely sale/special price
            if (visual.isHighlighted) {
                confidence = Math.min(confidence + 0.1, 1);
                console.log('💰 Price highlighted (sale/special):', { isHighlighted: true });
            }

            // Strikethrough = old price, reduce confidence
            if (visual.isStrikethrough) {
                confidence *= 0.3; // Drastically reduce
                console.log('💰 Price crossed out (old price):', { isStrikethrough: true });
            }

            // Large + prominent = main price
            if (visual.fontSize >= 18 && visual.prominenceScore > 0.5) {
                confidence = Math.min(confidence + 0.05, 1);
                console.log('💰 Price visually prominent:', {
                    fontSize: visual.fontSize,
                    prominence: visual.prominenceScore
                });
            }
        }

        // Class/attribute hints
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            const className = this.getClassNameString(element);
            if (/price|cost|amount|msrp/i.test(className)) {
                confidence = Math.max(confidence, 0.7);
                value = value || text.trim();
            }
        }

        return { fieldType: 'price', value, confidence };
    }

    /**
     * Detect image fields (IMG tags, background images)
     */
    private detectImage(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return { fieldType: 'image', value, confidence };
        }

        const element = node as HTMLElement;

        if (element.tagName === 'IMG') {
            // Prefer srcset over src
            value = this.getBestImageSource(element as HTMLImageElement);

            // Higher confidence for larger images
            const rect = element.getBoundingClientRect();
            const area = rect.width * rect.height;

            if (area > 10000) { // > 100x100
                confidence = 0.9;
            } else if (area > 2500) {
                confidence = 0.7;
            } else {
                confidence = 0.5; // Likely thumbnail/icon
            }
        }
        // Background images
        else {
            try {
                const bg = window.getComputedStyle(element).backgroundImage;
                if (bg && bg !== 'none') {
                    const url = this.extractUrlFromCss(bg);
                    if (url && !url.startsWith('data:')) {
                        confidence = 0.6;
                        value = url;
                    }
                }
            } catch (e) {
                // Ignore style access errors
            }
        }

        return { fieldType: 'image', value, confidence };
    }

    /**
     * Detect link fields (A tags)
     */
    private detectLink(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return { fieldType: 'link', value, confidence };
        }

        const element = node as HTMLElement;

        if (element.tagName === 'A') {
            const href = element.getAttribute('href');
            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                confidence = 0.95;
                try {
                    value = new URL(href, window.location.href).href;
                } catch (e) {
                    value = href;
                }
            }
        }

        return { fieldType: 'link', value, confidence };
    }

    /**
     * Detect date fields (patterns, <time> elements)
     */
    private detectDate(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        const text = node.textContent || '';

        // Date patterns
        const datePatterns = [
            /\d{1,2}\/\d{1,2}\/\d{2,4}/,
            /\d{4}-\d{2}-\d{2}/,
            /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i,
            /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
            /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i
        ];

        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                confidence = 0.85;
                value = match[0];
                break;
            }
        }

        // <time> element - highest confidence
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.tagName === 'TIME') {
                confidence = 0.95;
                value = element.getAttribute('datetime') || element.textContent?.trim();
            }
        }

        return { fieldType: 'date', value, confidence };
    }

    /**
     * Detect rating fields (stars, numeric ratings)
     */
    private detectRating(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        const text = node.textContent || '';

        // Star ratings (Unicode or text)
        const starMatch = text.match(/([★⭐♥✓]\s*){1,5}|(\d+\.?\d*)\s*\/\s*5|(\d+\.?\d*)\s*stars?/i);
        if (starMatch) {
            confidence = 0.8;
            value = starMatch[0];
        }

        // ARIA labels
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.getAttribute && element.getAttribute('aria-label')) {
                const ariaLabel = element.getAttribute('aria-label')!;
                if (/rating|stars|score/i.test(ariaLabel)) {
                    confidence = 0.9;
                    value = ariaLabel;
                }
            }

            // Rating class names
            const className = this.getClassNameString(element);
            if (className && /rating|stars|score/i.test(className)) {
                confidence = Math.max(confidence, 0.7);
                value = value || text.trim();
            }
        }

        return { fieldType: 'rating', value, confidence };
    }

    /**
     * Detect description fields (paragraphs with substantial text)
     */
    private detectDescription(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return { fieldType: 'description', value, confidence };
        }

        const element = node as HTMLElement;

        // Paragraphs with substantial text
        if (element.tagName === 'P' || element.tagName === 'SPAN' || element.tagName === 'DIV') {
            const text = element.textContent?.trim() || '';
            const wordCount = text.split(/\s+/).length;

            if (wordCount >= 10 && wordCount < 200) {
                confidence = 0.7;
                value = text;
            } else if (wordCount >= 200) {
                confidence = 0.8; // Long description
                value = text;
            }

            // Boost confidence for semantic attributes
            const className = this.getClassNameString(element);
            if (className && /description|summary|excerpt/i.test(className)) {
                confidence = Math.min(confidence + 0.1, 0.95);
            }
        }

        return { fieldType: 'description', value, confidence };
    }

    /**
     * Detect author fields ("by Author" patterns, microdata)
     */
    private detectAuthor(node: Node): SemanticField {
        let confidence = 0;
        let value = null;

        const text = node.textContent || '';

        // "by Author Name" pattern
        const authorMatch = text.match(/by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
        if (authorMatch) {
            confidence = 0.85;
            value = authorMatch[1];
        }

        // Microdata
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.getAttribute && element.getAttribute('itemprop') === 'author') {
                confidence = 0.95;
                value = element.textContent?.trim();
            }

            // Class/attribute hints
            const className = this.getClassNameString(element);
            if (className && /author|creator|writer/i.test(className)) {
                confidence = Math.max(confidence, 0.7);
                value = value || text.trim();
            }
        }

        return { fieldType: 'author', value, confidence };
    }

    /**
     * Get best image source (prioritize srcset > data-src > src)
     */
    private getBestImageSource(img: HTMLImageElement): string | null {
        // Try srcset first
        const srcset = img.getAttribute('srcset');
        if (srcset) {
            const sources = this.parseSrcset(srcset);
            if (sources.length > 0) {
                // Return largest image
                sources.sort((a, b) => b.width - a.width);
                return sources[0].url;
            }
        }

        // Try data-srcset
        const dataSrcset = img.getAttribute('data-srcset');
        if (dataSrcset) {
            const sources = this.parseSrcset(dataSrcset);
            if (sources.length > 0) {
                sources.sort((a, b) => b.width - a.width);
                return sources[0].url;
            }
        }

        // Try data-src
        const dataSrc = img.getAttribute('data-src');
        if (dataSrc && !dataSrc.startsWith('data:')) {
            return dataSrc;
        }

        // Fallback to src
        const src = img.getAttribute('src');
        if (src && !src.startsWith('data:')) {
            return src;
        }

        return null;
    }

    /**
     * Parse srcset attribute
     */
    private parseSrcset(srcset: string): Array<{ url: string; width: number }> {
        const sources: Array<{ url: string; width: number }> = [];
        const parts = srcset.split(',');

        for (const part of parts) {
            const trimmed = part.trim();
            const match = trimmed.match(/^(.+?)\s+(\d+)w$/);

            if (match) {
                sources.push({
                    url: match[1],
                    width: parseInt(match[2], 10)
                });
            } else {
                // No width descriptor, assume default
                sources.push({
                    url: trimmed,
                    width: 0
                });
            }
        }

        return sources;
    }

    /**
     * Extract URL from CSS background-image
     */
    private extractUrlFromCss(cssValue: string): string | null {
        const match = cssValue.match(/url\(['"]?(.+?)['"]?\)/);
        return match ? match[1] : null;
    }
}
