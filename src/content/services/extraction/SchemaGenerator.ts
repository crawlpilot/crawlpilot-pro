import { Column, ColumnType } from './ExtractionTypes';

/**
 * Handles schema generation and column inference matching the reference implementation
 * (background-readable.js lines 2100-2139)
 */
export class SchemaGenerator {
    /**
     * Generates a schema from a list of raw rows.
     * @param rawRows Array of raw data objects (keys are selector paths)
     * @returns Object containing the generated columns and a mapping from column ID to original keys
     */
    generateSchema(rawRows: any[]): { columns: Column[], mapping: Map<string, string[]> } {
        const allKeys = new Set<string>();
        rawRows.forEach(row => {
            Object.keys(row).forEach(key => allKeys.add(key));
        });

        // Map to track unique columns by ID
        const columnMap = new Map<string, Column>();
        const mapping = new Map<string, string[]>(); // columnId -> [originalKeys]

        Array.from(allKeys).forEach((originalKey, index) => {
            const { id, name, type } = this.processColumnInfo(originalKey, index, allKeys.size);

            if (!columnMap.has(id)) {
                columnMap.set(id, {
                    id,
                    originalId: originalKey,
                    name,
                    type,
                    selector: originalKey // Storing selector path as metadata
                });
                mapping.set(id, [originalKey]);
            } else {
                // Collision handling (should be rare with identical originalKey, but safeguard)
                const existing = columnMap.get(id)!;
                if (existing.originalId !== originalKey) {
                    // If hash collides but different key (very rare), we might need logic, 
                    // but reference just overwrites or assumes uniqueness of hash. 
                    // We will assume 1:1 for now as per reference which maps keys directly.
                }
            }
        });

        // Reference Logic: Extract Image Metadata (Dimensions) matching lines 2188-2213
        // We do this BEFORE filtering so we can look up the dimension columns if needed, 
        // strictly speaking we just need the key from rawRows.
        const columns = Array.from(columnMap.values());

        columns.forEach(col => {
            if (col.type === 'image') {
                const dimensionKey = col.originalId + " dimensions";
                let maxArea = 0;
                let bestMeta: any = null;

                // Iterate all rows to find max dimension for this column globally
                rawRows.forEach(row => {
                    const meta = row[dimensionKey];
                    if (meta && typeof meta === 'object' && meta.area) {
                        if (meta.area > maxArea) {
                            maxArea = meta.area;
                            bestMeta = meta;
                        }
                    }
                });

                if (bestMeta) {
                    col.imageMetadata = {
                        maxWidth: bestMeta.width,
                        maxHeight: bestMeta.height,
                        maxArea: bestMeta.area,
                        // maxParentWidth/Height/Area could be added if in raw data
                    };
                }
            }
        });

        let finalColumns = columns.filter(col =>
            !col.originalId.endsWith(' src dimensions') &&
            !col.originalId.endsWith(' background dimensions')
        );

        // [NEW] Unification is now deferred to the Table Rendering phase in DataTablePage 
        // to save massive memory during the extraction loop.

        // Reference Logic: Sort Columns (lines 2214-2222)
        // Images first (sorted by metadata area if avail), then others.
        // Since we might not have metadata fully calculated here without the dimensions pass,
        // we at least ensure Images are first as per generic type check.
        finalColumns.sort((a, b) => {
            const isImageA = a.type === 'image';
            const isImageB = b.type === 'image';

            if (isImageA && isImageB) {
                // If we had maxArea, we'd sort by it desc.
                // For now, keep stable or headers sort? Reference uses maxArea.
                const areaA = a.imageMetadata?.maxArea || 0;
                const areaB = b.imageMetadata?.maxArea || 0;
                return areaB - areaA;
            }
            if (isImageA && !isImageB) return -1; // Image comes first
            if (!isImageA && isImageB) return 1;  // Image comes first
            return 0;
        });

        // 7. Assign explicit order index to ensure persistence
        finalColumns.forEach((col, index) => {
            col.order = index;
        });

        return {
            columns: finalColumns,
            mapping
        };
    }

    /**
     * Ported logic for processing column info from a key (selector path)
     * background-readable.js lines 2102-2139
     */
    private processColumnInfo(key: string, index: number, _totalKeys: number): { id: string, name: string, type: ColumnType } {
        let name = key;
        let type: ColumnType = 'text';

        // 1. Suffix Checks (Attributes)
        if (name.endsWith(' href')) {
            name = name.replace(' href', ' URL');
            type = 'url';
        } else if (name.endsWith(' src')) {
            name = name.replace(' src', ' Image');
            type = 'image';
        } else if (name.endsWith(' alt')) {
            name = name.replace(' alt', ' Description');
            type = 'text';
        } else if (name.endsWith(' background')) {
            name = name.replace(' background', ' Background Image');
            type = 'image';
        }

        // 2. Clean up selector parts (e.g. "div > a")
        // Reference: e.split(" > ") ...
        const parts = name.split(' > ');
        if (parts.length > 0) {
            // Take last part, remove leading tag names like "div ", remove indices like "(0)"
            name = parts[parts.length - 1]
                .replace(/^[a-z]+\s+/, '')
                .replace(/\([0-9]+\)$/, '')
                .trim();
        }

        // 3. Keyword Checks
        const lowerName = name.toLowerCase();
        if (lowerName.includes('title') || lowerName.includes('heading')) {
            name = 'Title';
        } else if (lowerName.includes('description') || lowerName.includes('summary')) {
            name = 'Description';
        } else if (lowerName.includes('price')) {
            name = 'Price';
            type = 'price';
        } else if (lowerName.includes('author')) {
            name = 'Author';
        } else if (lowerName.includes('date')) {
            name = 'Date';
            type = 'date';
        } else if (lowerName.includes('rating')) {
            name = 'Rating';
            type = 'number'; // Reference says "rating" but maps to number/rating type
        } else if (lowerName.includes('review')) {
            name = 'Reviews';
        } else if (lowerName.includes('time_value')) {
            name = 'Time';
            // type = 'time'; // We don't have 'time' in our ColumnType enum yet, mapped to text or string
        } else if (name === 'link') {
            name = 'Link';
            type = 'url';
        } else if (type !== 'image' && name !== 'image' && name !== 'img') {
            // Fallback for image
            if (name === 'image' || name === 'img') {
                name = 'Image';
                type = 'image';
            }
        }

        // 4. Fallback Name
        if (!name || name.trim() === '') {
            name = `Column ${index + 1}`;
        }

        // 5. Capitalize
        name = name.split(' ').map(token => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');

        // 6. Generate ID (Base36 Hash) matching the normalized key
        const normalizedKey = this.normalizeSelector(key);
        const id = this.generateHashId(normalizedKey);

        return { id, name, type };
    }

    // unifyColumns and mergeRowData removed - logic delegated to TableUnifier in UI

    /**
     * Public helper to get the Column ID for a raw selector key
     * Used by mapppers to match raw data to columns
     */
    public getColumnId(rawKey: string): string {
        const normalized = this.normalizeSelector(rawKey);
        return this.generateHashId(normalized);
    }

    /**
     * Normalize selector to merge structurally identical columns
     * e.g., "div (1) > span" -> "div > span"
     */
    private normalizeSelector(key: string): string {
        return key
            .replace(/\s*\(\d+\)/g, '')   // Remove (N) indices
            .replace(/:nth-child\(\d+\)/g, '') // Remove nth-child
            .replace(/>\s*>/g, '>')  // Cleanup double arrows
            .trim();
    }

    /**
     * Deterministic ID generation matching reference
     * background-readable.js lines 2128-2134
     */
    private generateHashId(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36).slice(0, 8);
    }
}
