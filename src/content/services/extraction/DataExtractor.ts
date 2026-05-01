/* eslint-disable @typescript-eslint/no-explicit-any */
//import { SemanticFieldExtractor } from './SemanticFieldExtractor';
import { SchemaGenerator } from './SchemaGenerator';

/**
 * Extracts structured data from DOM elements
 * Enhanced with hash-based deduplication and semantic field extraction
 */

interface RowWithHash {
    data: any;
    hash: string;
}

export class DataExtractor {
    //private semanticExtractor = new SemanticFieldExtractor();
    private schemaGenerator = new SchemaGenerator();

    public extract(element: HTMLElement, containerInfo: any) {
        if (containerInfo.isContainer) {
            return this.extractList(containerInfo);
        } else {
            return this.extractSingle(element);
        }
    }

    private extractList(containerInfo: any) {
        const { siblings, confidence } = containerInfo;
        const rowsWithHash: RowWithHash[] = [];
        const seenHashes = new Set<string>();
        let duplicateCount = 0;

        siblings.forEach((child: HTMLElement) => {
            // Extract hierarchical data
            const rowData = this.extractRow(child);

            // Extract semantic fields
            //const semanticData = this.semanticExtractor.extractFields(child);

            // Merge semantic fields with hierarchical data
            //const mergedData = { ...rowData, ...semanticData.fields };

            // Generate hash for deduplication
            const hash = this.hashData(rowData);

            if (seenHashes.has(hash)) {
                duplicateCount++;
            } else {
                seenHashes.add(hash);
                rowsWithHash.push({ data: rowData, hash });
            }
        });

        // Extract just the data
        const rows = rowsWithHash.map(r => r.data);

        // Generate columns using SchemaGenerator (Reference Logic)
        const schemaResult = this.schemaGenerator.generateSchema(rows);
        const columns = schemaResult.columns;

        // Map raw rows to new schema IDs (normalized data)
        const items = this.normalizeData(rows, columns);

        return {
            type: containerInfo.containerType === 'table' ? 'table' : 'list',
            columns: columns,
            items: items,
            source_url: window.location.href,
            count: items.length,
            timestamp: new Date().toISOString(),
            metadata: {
                containerConfidence: confidence || 0,
                duplicatesRemoved: duplicateCount,
                uniqueItems: items.length
            }
        };
    }

    private extractSingle(element: HTMLElement) {
        // [NEW] Smart Extraction for Single Elements (e.g., Buyboxes)
        // Instead of returning a single text blob, we extract the entire hierarchical DOM 
        // structure under this element, just like we do for a row in a list.
        const rowData = this.extractRow(element);

        // For single extraction, we create pseudo-columns from the keys
        const rows = [rowData];

        // Generate columns using SchemaGenerator so it looks identical to a list of 1
        const schemaResult = this.schemaGenerator.generateSchema(rows);
        const columns = schemaResult.columns;

        // Map raw rows to new schema IDs
        const items = this.normalizeData(rows, columns);

        return {
            type: 'list', // [CRITICAL] Fake it as a 'list' so PageExtractionStrategy explodes the columns
            columns: columns,
            items: items, // Return normalized items (array of 1)
            source_url: window.location.href,
            timestamp: new Date().toISOString()
        };
    }

    public extractRow(element: HTMLElement) {
        const rowData: any = {};
        this.processNode(element, [], {}, rowData);
        return rowData;
    }

    private processNode(t: HTMLElement, parentPath: string[], parentCounts: any, results: any) {
        if (!t || !t.tagName || ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(t.tagName)) return;

        // Skip hidden elements if needed, but sometimes structure is more important
        // [FIX] Relaxed visibility check: Some valid elements might have null offsetParent (e.g. fixed position) 
        // but still contain data. Check if they have dimensions or content.
        const rect = t.getBoundingClientRect();
        const hasDimensions = rect.width > 0 && rect.height > 0;

        // If it's a root Li or Div that is common for list items, don't skip it just because it's technically "hidden"
        // as long as it has children to explore.
        const isCommonListItem = ["LI", "DIV", "ARTICLE", "SECTION"].includes(t.tagName);
        const hasChildren = t.children.length > 0;

        if (t.offsetParent === null && !hasDimensions && !t.innerText.trim() && !(isCommonListItem && hasChildren)) return;

        const { displayLabel } = this.generateNodeName(t);

        // Update counts for this label in the parent's context
        parentCounts[displayLabel] = (parentCounts[displayLabel] || 0) + 1;
        const count = parentCounts[displayLabel];

        // Construct path component e.g. "Div > Span (2)"
        // This effectively hashes the position so unrelated spans don't merge
        const pathComponent = `${displayLabel}${count > 1 ? ` (${count})` : ""}`;
        const currentPath = [...parentPath, pathComponent];
        const key = currentPath.join(" > ");

        // 1. Extract Text
        let directText = "";
        try {
            if (t.childNodes) {
                directText = Array.from(t.childNodes)
                    .filter(n => n.nodeType === Node.TEXT_NODE)
                    .map(n => n.textContent?.trim())
                    .filter(Boolean)
                    .join(" ");
            }
        } catch (e) { console.error('Error extracting text', e); }

        if (directText && (directText.length > 1 || /\d/.test(directText))) {
            results[key] = directText;
        }

        // [IMPROVED] Always check for aria-label or title as they are priority context,
        // even if directText was found.
        const ariaLabel = t.getAttribute('aria-label');
        const title = t.getAttribute('title');
        if (ariaLabel && ariaLabel.trim()) results[`${key} label`] = ariaLabel.trim();
        if (title && title.trim()) results[`${key} title`] = title.trim();

        // 2. Extract Links
        if (t.tagName === "A") {
            const href = t.getAttribute("href");
            if (href && !href.trim().toLowerCase().startsWith("javascript:") && !href.startsWith("#")) {
                results[`${key} href`] = this.normalizeUrl(href.trim());
            }
        }

        // 3. Extract Images
        if (t.tagName === "IMG") {
            let src = t.getAttribute("src");
            // Logic for data-src/srcset (simplified)
            if (!src) src = t.getAttribute("data-src");
            if (!src) src = t.getAttribute("data-lazy-src");

            if (src && !src.startsWith("data:")) {
                results[`${key} src`] = this.normalizeUrl(src.trim());

                // Reference Logic: Extract dimensions (background-readable.js 1977)
                // This allows SchemaGenerator to sort images by size
                if (t instanceof HTMLImageElement) {
                    const width = t.naturalWidth || t.width || 0;
                    const height = t.naturalHeight || t.height || 0;
                    const area = width * height;
                    if (area > 0) {
                        results[`${key} src dimensions`] = {
                            width,
                            height,
                            area
                        };
                    }
                }
            }

            const alt = t.getAttribute("alt");
            if (alt && typeof alt === "string" && alt.trim()) {
                results[`${key} alt`] = alt.trim();
            }
        }

        // 4. Recurse children
        const children = Array.from(t.children) as HTMLElement[];
        if (children.length > 0) {
            const currentCounts = {}; // Counts for children of t
            for (const child of children) {
                this.processNode(child, currentPath, currentCounts, results);
            }
        }
    }

    private normalizeUrl(t: string): string {
        if (!t) return "";
        if (t.trim().toLowerCase().startsWith("javascript:")) return "";
        if (t.startsWith("http://") || t.startsWith("https://")) return t;
        if (t.startsWith("//")) return `${window.location.protocol}${t}`;

        const { protocol, host, pathname } = window.location;
        const origin = `${protocol}//${host}`;

        if (t.startsWith("/")) return `${origin}${t}`;

        const pathParts = pathname.split("/").filter(Boolean);
        pathParts.pop();
        return `${origin}${pathParts.length > 0 ? `/${pathParts.join("/")}/` : "/"}${t}`;
    }

    private generateNodeName(t: HTMLElement) {
        // Reference Logic (background-readable.js lines 1902-1936)

        // 1. Helper to find stable class
        const getStableClass = (el: HTMLElement) => {
            const excludedPrefixes = ["js-", "data-"];
            const classes = (el.getAttribute("class") || "").split(/\s+/).filter(c => {
                return c &&
                    !excludedPrefixes.some(exc => c.startsWith(exc)) &&
                    !/^\d+$/.test(c);
            });
            // Return first class if any, else tagName
            return classes.length > 0 ? classes[0] : el.tagName.toLowerCase();
        };

        // CRITICAL FINDING: The reference logic actually uses the first stable CLASS (or tagname) as the key component!
        // It mostly IGNORES 'displayLabel' (which is calculated as 'n' inside the function) for the PATH generation.

        // Use the helper appropriately
        const pathLabel = getStableClass(t);

        return {
            id: t.id || "",
            displayLabel: pathLabel
        };
    }



    public normalizeData(rows: any[], columns: any[]) {
        return rows.map(row => this.normalizeRow(row, columns));
    }

    /**
     * Normalizes a single raw row using the generated columns.
     * Maps original raw keys (paths) to their merged column IDs.
     */
    public normalizeRow(row: any, columns: any[]) {
        const newRow: any = {};
        columns.forEach(col => {
            // Check all potential keys that map to this column ID
            const val = row[col.originalId];
            if (val !== undefined) {
                newRow[col.id] = val;
            }

            // [NEW] Handle merged keys if SchemaGenerator provided a list (in future)
            // For now, we assume originalId is sufficient because it matches the first seen path.
        });
        return newRow;
    }

    /**
     * Generate deterministic hash from object for deduplication
     */
    private hashData(data: any): string {
        const sorted = this.sortObjectKeys(data);
        const json = JSON.stringify(sorted);

        let hash = 0;
        for (let i = 0; i < json.length; i++) {
            hash = ((hash << 5) - hash) + json.charCodeAt(i);
            hash |= 0; // Convert to 32-bit integer
        }

        return hash.toString();
    }

    /**
     * Deep sort object keys for consistent hashing
     */
    private sortObjectKeys(obj: any): any {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObjectKeys(item));
        }

        return Object.keys(obj)
            .sort()
            .reduce((result: any, key) => {
                result[key] = this.sortObjectKeys(obj[key]);
                return result;
            }, {});
    }
}
