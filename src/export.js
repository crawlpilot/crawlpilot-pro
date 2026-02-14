/**
 * ENHANCED CONTENT SCRIPT - Integrated Complete Replica
 * 
 * This combines the original content.js functionality with the complete replica
 * for a more robust and feature-rich extraction system.
 */

console.log("🚀 CrawlPilot Enhanced Content Script Loading...");

// Add visual indicator that script loaded
const loadIndicator = document.createElement('div');
loadIndicator.id = 'crawlpilot-load-indicator';
loadIndicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #FFE100 0%, #FFC700 100%);
    color: black;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: bold;
    z-index: 999999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
    font-size: 13px;
    animation: slideIn 0.3s ease-out;
`;
loadIndicator.innerHTML = '✅ CrawlPilot Loaded';

// Add animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);

// Add indicator when DOM is ready
if (document.body) {
    document.body.appendChild(loadIndicator);
    // Remove after 3 seconds
    setTimeout(() => {
        loadIndicator.style.transition = 'opacity 0.3s';
        loadIndicator.style.opacity = '0';
        setTimeout(() => loadIndicator.remove(), 300);
    }, 3000);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(loadIndicator);
        setTimeout(() => {
            loadIndicator.style.transition = 'opacity 0.3s';
            loadIndicator.style.opacity = '0';
            setTimeout(() => loadIndicator.remove(), 300);
        }, 3000);
    });
}

window.crawlPilotContentScriptLoaded = true;
console.log("✅ CrawlPilot Enhanced Content Script Loaded!");

// ============================================================================
// VISUAL ELEMENT PICKER (Enhanced)
// ============================================================================

class VisualElementPicker {
    constructor() {
        this.isActive = false;
        this.overlay = null;
        this.highlightBox = null;
        this.tooltip = null;
        this.currentElement = null;
        this.onSelectCallback = null;

        // Bind event handlers
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleClick = this.handleClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
    }

    activate(onSelectCallback) {
        if (this.isActive) return;

        this.isActive = true;
        this.onSelectCallback = onSelectCallback;
        this.createUI();
        this.attachEventListeners();

        console.log('✅ Enhanced Element Picker Activated');
    }

    deactivate() {
        if (!this.isActive) return;

        this.isActive = false;
        this.removeUI();
        this.removeEventListeners();
        this.currentElement = null;

        console.log('❌ Element Picker Deactivated');
    }

    createUI() {
        // 1. Overlay
        this.overlay = document.createElement('div');
        this.overlay.id = 'crawlpilot-overlay';
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            zIndex: '2147483647',
            cursor: 'crosshair',
            pointerEvents: 'all'
        });
        document.body.appendChild(this.overlay);

        // 2. Highlight Box
        this.highlightBox = document.createElement('div');
        this.highlightBox.id = 'crawlpilot-highlight';
        Object.assign(this.highlightBox.style, {
            position: 'fixed',
            border: '2px solid #FFE100',
            boxShadow: '0 0 0 4000px rgba(0, 0, 0, 0.5), 0 0 10px rgba(255, 225, 0, 0.7)',
            backgroundColor: 'rgba(255, 225, 0, 0.1)',
            zIndex: '2147483646',
            pointerEvents: 'none',
            display: 'none',
            transition: 'all 0.1s ease-out',
            borderRadius: '4px'
        });
        document.body.appendChild(this.highlightBox);

        // 3. Tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.id = 'crawlpilot-tooltip';
        Object.assign(this.tooltip.style, {
            position: 'fixed',
            padding: '12px 16px',
            backgroundColor: '#FFE100',
            color: '#000',
            borderRadius: '8px',
            fontWeight: 'bold',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: '2147483648',
            pointerEvents: 'none',
            display: 'none',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            maxWidth: '300px',
            lineHeight: '1.4'
        });
        document.body.appendChild(this.tooltip);
    }

    removeUI() {
        if (this.overlay) this.overlay.remove();
        if (this.highlightBox) this.highlightBox.remove();
        if (this.tooltip) this.tooltip.remove();
    }

    attachEventListeners() {
        document.addEventListener('mousemove', this.handleMouseMove, true);
        document.addEventListener('click', this.handleClick, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('scroll', this.handleScroll, { passive: true, capture: true });
    }

    removeEventListeners() {
        document.removeEventListener('mousemove', this.handleMouseMove, true);
        document.removeEventListener('click', this.handleClick, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('scroll', this.handleScroll, true);
    }

    handleMouseMove(event) {
        this.overlay.style.pointerEvents = 'none';
        const element = document.elementFromPoint(event.clientX, event.clientY);
        this.overlay.style.pointerEvents = 'all';

        if (!element ||
            element === this.overlay ||
            element === document.documentElement ||
            element === document.body) {
            return;
        }

        // Use ContainerDetector to check for list
        const detector = new ContainerDetector();
        const containerInfo = detector.findContainer(element);

        let targetElement = element;
        let isListContainer = false;

        if (containerInfo.isContainer) {
            targetElement = containerInfo.container;
            isListContainer = true;
        }

        if (this.currentElement !== targetElement) {
            this.currentElement = targetElement;
            this.updateHighlight(targetElement, isListContainer, containerInfo);
        }
    }

    updateHighlight(element, isListContainer, containerInfo) {
        const rect = element.getBoundingClientRect();

        Object.assign(this.highlightBox.style, {
            display: 'block',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });

        let mainText, secondaryText;

        if (isListContainer) {
            const itemCount = containerInfo.childCount || element.children.length;
            mainText = `📋 List Container (${itemCount} items)`;
            secondaryText = containerInfo.isSmart ? '✨ Smart Parent Detected' : 'List Container Detected';
        } else {
            const tag = element.tagName.toLowerCase();
            const className = element.className && typeof element.className === 'string'
                ? `.${element.className.split(' ')[0]}`
                : '';
            mainText = `${tag}${className}`;
            secondaryText = 'Click to select';
        }

        this.tooltip.innerHTML = `
            <div style="font-weight: bold;">${mainText}</div>
            <div style="font-size: 11px; margin-top: 4px; opacity: 0.85;">${secondaryText}</div>
        `;
        this.tooltip.style.display = 'block';

        this.positionTooltip(rect);
    }

    positionTooltip(elementRect) {
        const tooltipRect = this.tooltip.getBoundingClientRect();

        let top = elementRect.top - tooltipRect.height - 10;
        let left = elementRect.left + (elementRect.width / 2) - (tooltipRect.width / 2);

        if (top < 10) {
            top = elementRect.bottom + 10;
        }

        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    handleClick(event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.currentElement && this.onSelectCallback) {
            console.log('🎯 Element Selected:', this.currentElement);
            this.onSelectCallback(this.currentElement);
        }

        this.deactivate();
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            console.log('⚠️ Selection Cancelled');
            this.deactivate();
        }
    }

    handleScroll() {
        if (this.currentElement) {
            const rect = this.currentElement.getBoundingClientRect();
            Object.assign(this.highlightBox.style, {
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`
            });
        }
    }
}

// ============================================================================
// CONTAINER DETECTOR
// ============================================================================

class ContainerDetector {
    constructor() {
        this.maxLevelsUp = 3;
        this.minSiblings = 2;
    }

    findContainer(element) {
        // Advanced logic ported from test.js

        // 1. Try finding by group parent (clustering)
        try {
            const groupResult = this.findGroupParent(element);
            if (groupResult && groupResult.bestCandidate) {
                return {
                    isContainer: true,
                    container: groupResult.bestCandidate.tableNode,
                    childCount: groupResult.bestCandidate.childCount,
                    childElement: groupResult.bestCandidate.rowNode,
                    siblings: groupResult.bestCandidate.children,
                    isSmart: true
                };
            }
        } catch (e) {
            // console.error("Smart detection failed:", e);
        }

        // 2. Fallback: Simple heuristic traversal
        let current = element;
        let bestContainer = null;
        let maxChildren = 0;

        for (let i = 0; i < 10 && current && current !== document.body; i++) {
            if (this.isLikelyListContainer(current)) {
                const childCount = current.children.length;
                if (childCount > maxChildren) {
                    bestContainer = current;
                    maxChildren = childCount;
                }
            }
            current = current.parentElement;
        }

        if (bestContainer) {
            return {
                isContainer: true,
                container: bestContainer,
                childCount: maxChildren,
                siblings: Array.from(bestContainer.children),
                isSmart: false
            };
        }

        return {
            isContainer: false,
            container: null,
            childCount: 0
        };
    }

    findGroupParent(startElement) {
        let current = startElement;
        let candidates = [];
        let maxCount = 0;

        // Traverse up
        while (current && current !== document.body && current !== document.documentElement) {
            let validCount = 0;
            let validChildren = [];

            for (let child of current.children) {
                if (this.isValidGroupElement(child) && child.offsetHeight > 0) {
                    validChildren.push(child);
                    validCount++;
                }
            }

            if (validCount >= this.minRowsFilter) {
                candidates.push({
                    tableNode: current,
                    children: validChildren,
                    rowNode: validChildren[0],
                    childCount: validCount
                });
                if (validCount > maxCount) {
                    maxCount = validCount;
                }
            }
            current = current.parentElement;
        }

        let best = null;
        for (let c of candidates) {
            if (c.childCount === maxCount) {
                best = c;
                break;
            }
        }

        return {
            bestCandidate: best,
            candidates: candidates
        };
    }

    isValidGroupElement(element) {
        const tag = element.tagName;
        return ["TR", "SUMMARY", "LI", "DIV", "DETAILS", "ASIDE", "ARTICLE", "A", "FIGURE", "SPAN"].includes(tag) || /-/g.test(tag);
    }

    isLikelyListContainer(t) {
        if (!t || !t.children || t.children.length < 2) return false;

        const tag = t.tagName;
        if (["UL", "OL", "DL", "TBODY", "TABLE", "GRID"].includes(tag)) return true;

        const role = t.getAttribute("role");
        if (role === "list" || role === "grid") return true;

        const cls = (t.getAttribute("class") || "").toLowerCase();
        if (cls.includes("list") || cls.includes("results") || cls.includes("grid") || cls.includes("cards") || cls.includes("products")) {
            if (t.children.length >= 2) return true;
        }

        const children = Array.from(t.children);
        if (children.length >= 3) {
            const heights = children.map(c => c.offsetHeight);
            const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
            const uniformHeight = heights.every(h => Math.abs(h - avgHeight) < 0.5 * avgHeight);
            if (uniformHeight) return true;
        }

        const tagCounts = {};
        children.forEach(c => tagCounts[c.tagName] = (tagCounts[c.tagName] || 0) + 1);
        const mostCommonTag = Object.keys(tagCounts).reduce((a, b) => tagCounts[a] > tagCounts[b] ? a : b);

        if (tagCounts[mostCommonTag] / children.length >= 0.6) return true;

        try {
            const display = window.getComputedStyle(t).display;
            if (display === "grid" || display === "flex") return true;
        } catch (e) { }

        return false;
    }
}

// ============================================================================
// DATA EXTRACTOR (Enhanced)
// ============================================================================

class DataExtractor {
    constructor() {
        this.maxDepth = 5;
    }

    extract(element, containerInfo) {
        console.log('🎯 extract() called');
        console.log('  Element:', element);
        console.log('  ContainerInfo:', containerInfo);
        console.log('  isContainer:', containerInfo.isContainer);

        if (containerInfo.isContainer) {
            console.log('✅ Extracting as LIST');
            return this.extractList(containerInfo);
        } else {
            console.log('⚠️ Extracting as SINGLE (no container detected)');
            return this.extractSingle(element);
        }
    }

    extractList(containerInfo) {
        console.log('🔍 extractList called with:', containerInfo);

        const { container, siblings } = containerInfo;

        if (!siblings || siblings.length === 0) {
            console.error('❌ No siblings found in containerInfo!');
            return {
                success: false,
                type: 'list',
                count: 0,
                columns: [],
                items: [],
                error: 'No list items found',
                source_url: window.location.href,
                timestamp: new Date().toISOString()
            };
        }

        console.log(`📊 Extracting ${siblings.length} items...`);
        const rows = [];

        siblings.forEach((child, index) => {
            const rowData = this.extractRow(child, index);
            rows.push(rowData);
        });

        const columns = this.generateColumns(rows);

        console.log(`✅ Extracted ${rows.length} rows with ${columns.length} columns`);

        return {
            success: true,
            type: 'list',
            count: rows.length,
            columns: columns,
            items: rows,
            source_url: window.location.href,
            timestamp: new Date().toISOString()
        };
    }

    unifyColumns(rows, columns) {
        if (!columns || columns.length === 0) return [];

        const finalCols = [];

        columns.forEach(col => {
            if (col.name === 'Text Content') {
                finalCols.push(col);
                return;
            }

            // Find a compatible existing column to merge into
            const match = finalCols.find(existing => {
                // 1. Must match Name and Type
                if (existing.name !== col.name || existing.type !== col.type) return false;

                // 2. COLLISION CHECK
                // Are these columns "compatible"? 
                // They are compatible if they never have conflicting values in the same row.
                const hasCollision = rows.some(row => {
                    const val1 = row[existing.originalId];
                    const val2 = row[col.originalId];

                    // Collision = Both have values, and they are different
                    return (val1 && val2 && val1 !== val2);
                });

                return !hasCollision;
            });

            if (match) {
                // Merge this column into the matching existing column
                this.mergeRowData(rows, col.originalId, match.originalId);
            } else {
                // No match or collision found -> Keep as separate column

                // Ensure unique name if we have a name collision but different data
                let name = col.name;
                let count = 2;
                while (finalCols.some(c => c.name === name)) {
                    name = `${col.name} ${count}`;
                    count++;
                }
                col.name = name;

                finalCols.push(col);
            }
        });

        return finalCols;
    }

    mergeRowData(rows, sourceId, targetId) {
        rows.forEach(row => {
            if (Object.prototype.hasOwnProperty.call(row, sourceId)) {
                const val = row[sourceId];
                if (val !== undefined && val !== null && val !== "") {
                    if (row[targetId]) {
                        if (row[targetId] !== val) {
                            row[targetId] = `${row[targetId]} | ${val}`;
                        }
                    } else {
                        row[targetId] = val;
                    }
                }
                delete row[sourceId];
            }
        });
    }

    extractRow(element, rowIndex) {
        console.log(`🔍 extractRow #${rowIndex}:`, element);
        const rowData = {};
        this.processNode(element, [], {}, rowData);
        console.log(`  → Row data:`, rowData, `(${Object.keys(rowData).length} keys)`);
        return rowData;
    }

    processNode(t, parentPath, parentCounts, results) {
        if (!t || !t.tagName || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(t.tagName)) return;

        const { displayLabel } = this.generateNodeName(t);

        // Update counts for this label in the parent's context
        parentCounts[displayLabel] = (parentCounts[displayLabel] || 0) + 1;
        const count = parentCounts[displayLabel];

        // Construct path component
        const pathComponent = `${displayLabel}${count > 1 ? ` (${count})` : ""}`;
        const currentPath = [...parentPath, pathComponent];
        const key = currentPath.join(" > ");

        // 1. Extract Text
        let directText = "";
        try {
            if (t.childNodes) {
                directText = Array.from(t.childNodes)
                    .filter(n => n.nodeType === Node.TEXT_NODE)
                    .map(n => n.textContent.trim())
                    .filter(Boolean)
                    .join(" ");
            }
        } catch (e) { console.error('Error extracting text', e); }

        if (directText) {
            results[key] = directText;
        }

        // 2. Extract Links
        if (t.tagName === "A") {
            const href = t.getAttribute("href");
            if (href && !href.trim().toLowerCase().startsWith("javascript:")) {
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
            }

            const alt = t.getAttribute("alt");
            if (alt && typeof alt === "string" && alt.trim()) {
                results[`${key} alt`] = alt.trim();
            }
        }

        // 4. Recurse children
        const children = Array.from(t.children);
        if (children.length > 0) {
            const currentCounts = {}; // Counts for children of t
            for (const child of children) {
                this.processNode(child, currentPath, currentCounts, results);
            }
        }
    }

    normalizeUrl(t) {
        if (!t) return "";
        if (typeof t !== "string") {
            try { t = String(t); } catch (e) { return ""; }
        }
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

    generateNodeName(t) {
        // Ported from background_bundle.js logic
        const sensitivePrefixes = ["js-", "data-"];
        const classes = (t.getAttribute("class") || "").split(/\s+/).filter(c =>
            c && !sensitivePrefixes.some(pre => c.startsWith(pre)) && !/^\d+$/.test(c)
        );

        let name = "";
        // Try data attributes
        const dataAttrs = Array.from(t.attributes).filter(a => a.name.startsWith("data-")).map(a => a.name);
        if (dataAttrs.length > 0) name = dataAttrs[0].replace("data-", "");

        if (!name) {
            // CAREFUL: Avoid using IDs that might be unique per item (like ASINs on Amazon)
            // Kept this filter because original code WITHOUT it causes column explosion on Amazon
            const id = t.id;
            if (id && !/^B0[A-Z0-9]{8}$/.test(id) && !/\d{5,}/.test(id)) {
                name = id;
            } else if (t.getAttribute("role")) {
                name = t.getAttribute("role");
            } else if (t.getAttribute("aria-label")) {
                name = t.getAttribute("aria-label");
            }
        }

        if (!name) {
            const tag = t.tagName.toLowerCase();
            if (tag === "a") name = "link";
            else if (tag === "img") name = "image";
            else if (tag === "button") name = "button";
            else if (["h1", "h2", "h3", "h4"].includes(tag)) name = "heading";
            else if (tag === "p") name = "paragraph";
            else if (tag === "span" && t.textContent.trim()) {
                const text = t.textContent.trim();
                const isNumeric = /^[\d,]+$/.test(text) || /^[\d,]+\.\d+$/.test(text);
                const isTime = /\b(days?|hours?|minutes?|seconds?|weeks?|months?)\b/i.test(text);
                name = isNumeric ? "numeric_value" : isTime ? "time_value" : text.length > 20 ? "description" : "text_content";
            } else if (tag === "div") {
                if (t.querySelector("img")) name = "image_container";
                else if (t.querySelector("a")) name = "link_container";
                else if (t.querySelectorAll("div, span").length > 3) name = "container";
            }
        }

        if (!name) {
            const cleanClasses = (t.getAttribute("class") || "").split(/\s+/).filter(Boolean);
            // Exact regex from background_bundle.js line 1950
            name = cleanClasses.find(c => !c.includes("__") && !c.match(/^sc-[a-z0-9]/) && !c.match(/^[a-z][0-9]/) && c.length > 2) ||
                (cleanClasses.length > 0 ? cleanClasses[0] : t.tagName.toLowerCase());
        }

        return { id: t.id || "", displayLabel: name };
    }

    humanize(str) {
        if (!str) return "";
        return str
            .replace(/[-_]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    generateColumns(rows) {
        if (!rows || rows.length === 0) return [];

        const keyFrequency = {};
        const keyDataSample = {};

        // Calculate frequency and collect samples
        rows.forEach(row => {
            Object.keys(row).forEach(key => {
                keyFrequency[key] = (keyFrequency[key] || 0) + 1;
                if (!keyDataSample[key]) keyDataSample[key] = new Set();
                if (keyDataSample[key].size < 5 && row[key]) keyDataSample[key].add(row[key]);
            });
        });

        // 1. Gather meaningful keys (Threshold = 2 rows or >0 if few rows)
        // Reduced threshold to ensure Ratings/Reviews are kept even if sparse
        const threshold = Math.max(2, Math.round(rows.length * 0.1));
        const meaningfulKeys = Object.keys(keyFrequency).filter(key =>
            keyFrequency[key] >= threshold || (rows.length < 5 && keyFrequency[key] > 0)
        );

        // 2. Map keys to Columns using logic from background_bundle.js naming conventions
        let columns = meaningfulKeys.map(t => {
            let e = t;
            let a = "text";

            // Name/Type inference logic ported from background_bundle.js
            if (e.endsWith(" href")) { e = e.replace(" href", " URL"); a = "link"; }
            else if (e.endsWith(" src")) { e = e.replace(" src", " Image"); a = "image"; }
            else if (e.endsWith(" alt")) { e = e.replace(" alt", " Description"); a = "text"; }
            else if (e.endsWith(" background")) { e = e.replace(" background", " Background Image"); a = "image"; }

            // Name cleanup
            const r = e.split(" > ");
            if (r.length > 0) {
                e = r[r.length - 1].replace(/^[a-z]+\s+/, "").replace(/\([0-9]+\)$/, "").trim();
            }

            // Keyword mapping
            if (e.includes("title") || e.includes("heading")) e = "Title";
            else if (e.includes("description") || e.includes("summary")) e = "Description";
            else if (e.includes("price")) { e = "Price"; a = "price"; }
            else if (e.includes("author")) e = "Author";
            else if (e.includes("date")) { e = "Date"; a = "date"; }
            else if (e.includes("rating")) { e = "Rating"; a = "rating"; }
            else if (e.includes("review")) e = "Reviews";
            else if (e.includes("time_value")) { e = "Time"; a = "time"; }
            else if (e === "link") { e = "Link"; a = "link"; }
            else if (e !== "image" && e !== "img") { } // Default
            else { e = "Image"; a = "image"; }

            // Value-based refinement (Safety check not in original but needed for robustness)
            if (a === "text") {
                const sampleRow = rows.find(r => r[t]);
                if (sampleRow) {
                    const val = sampleRow[t];
                    if (val && typeof val === 'string') {
                        if (/^[\d,]+$/.test(val) || /^[\d,]+\.\d+$/.test(val)) a = "number";
                        else if ((val.startsWith("http") || val.startsWith("www")) && !t.endsWith(" href")) a = "link";
                        else if (val.length > 100) e = "Description";
                    }
                }
            }

            const colId = this.generateHash(t);
            return {
                id: colId,
                originalId: t,
                name: e.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "), // Capitalize
                type: a
            };
        });

        // 3. Deduplicate exact data matches
        // Only remove a column if it is 100% identical to another column
        const uniqueDataFingerprints = new Map();
        const finalColumns = [];

        // Priority sort for keeping best column: title/price/image first
        columns.sort((a, b) => {
            const score = k => {
                const n = k.name.toLowerCase();
                if (n.includes('title')) return 10;
                if (n.includes('price')) return 9;
                if (n.includes('image')) return 8;
                return 0;
            };
            return score(b) - score(a);
        });

        for (const col of columns) {
            const data = rows.map(r => r[col.originalId] || '').join('||');
            // Skip empty data columns? No, keep them if they are unique, but ignore completely empty ones
            if (data.replaceAll('|', '').length === 0) continue;

            if (!uniqueDataFingerprints.has(data)) {
                uniqueDataFingerprints.set(data, col);
                finalColumns.push(col);
            }
        }


        // Consolidate columns that have same Name & Type to fix "exploded" view
        const unifiedCols = this.unifyColumns(rows, finalColumns);

        // 5. Finalize Data: Remap row keys from originalId (path) to id (hash)
        // This ensures the frontend (which uses IDs) can find the data
        rows.forEach(row => {
            unifiedCols.forEach(col => {
                if (Object.prototype.hasOwnProperty.call(row, col.originalId)) {
                    row[col.id] = row[col.originalId];
                    if (col.id !== col.originalId) {
                        delete row[col.originalId];
                    }
                }
            });
        });

        return unifiedCols.sort((a, b) => {
            const order = { 'Title': 1, 'Price': 2, 'Image': 3, 'Rating': 4, 'Reviews': 5, 'Link': 6 };
            const oa = order[a.name] || 99;
            const ob = order[b.name] || 99;
            return oa - ob;
        });
    }

    getColumnWeight(name, type) {
        const n = name.toLowerCase();
        if (n.includes('title') || n.includes('name') || n.includes('heading')) return 1;
        if (type === 'image') return 2;
        if (type === 'price' || n.includes('price')) return 3;
        if (n.includes('rating') || n.includes('star')) return 4;
        if (n.includes('review')) return 5;
        if (type === 'link') return 100; // Links last
        return 50;
    }

    extractSingle(element) {
        const data = {};
        this.traverseSingle(element, [], data, 0);

        return {
            success: true,
            type: 'single',
            data: data,
            source_url: window.location.href,
            timestamp: new Date().toISOString()
        };
    }

    traverseSingle(element, path, storage, depth) {
        if (!element || depth > this.maxDepth) return;
        if (element.offsetParent === null) return;

        const label = this.generateLabel(element);
        const currentPath = [...path, label];
        const pathKey = currentPath.join(' > ');

        const directText = this.getDirectText(element);
        if (directText) {
            storage[pathKey] = { type: 'text', value: directText };
        }

        if (element.tagName === 'IMG' && element.src) {
            storage[pathKey + ' [img]'] = { type: 'image', value: element.src };
        }

        if (element.tagName === 'A' && element.href) {
            storage[pathKey + ' [link]'] = { type: 'link', value: element.href };
        }

        Array.from(element.children).forEach(child => {
            this.traverseSingle(child, currentPath, storage, depth + 1);
        });
    }

    generateLabel(element) {
        if (element.id) return `#${element.id}`;
        if (element.className && typeof element.className === 'string') {
            const firstClass = element.className.trim().split(' ')[0];
            if (firstClass) return `.${firstClass}`;
        }
        return element.tagName.toLowerCase();
    }

    generateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36).slice(0, 8);
    }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

console.log('🔧 Initializing global instances...');

try {
    window.elementPicker = new VisualElementPicker();
    console.log('✅ VisualElementPicker created');
} catch (e) {
    console.error('❌ Error creating VisualElementPicker:', e);
}

try {
    window.containerDetector = new ContainerDetector();
    console.log('✅ ContainerDetector created');
} catch (e) {
    console.error('❌ Error creating ContainerDetector:', e);
}

try {
    window.dataExtractor = new DataExtractor();
    console.log('✅ DataExtractor created');
} catch (e) {
    console.error('❌ Error creating DataExtractor:', e);
}

console.log('🔧 Global instances initialized');

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Message received:', request.action);

    if (request.action === 'start_selection') {
        if (!window.elementPicker) {
            console.error('❌ elementPicker not initialized!');
            sendResponse({ status: 'error', message: 'Element picker not initialized' });
            return true;
        }

        window.elementPicker.activate((selectedElement) => {
            try {
                // Detect container
                const containerInfo = window.containerDetector.findContainer(selectedElement);

                // Extract data
                const data = window.dataExtractor.extract(selectedElement, containerInfo);

                console.log('✅ Extraction Result:', data);

                // NOTE: Saving is now handled by the background script to ensure consistency across the extension
                // content_enhanced.js -> background.js -> Extension IndexedDB

                // Send message back to extension
                chrome.runtime.sendMessage({
                    action: 'selection_completed',
                    data: data
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("❌ Error sending selection_completed:", chrome.runtime.lastError.message);
                    }
                });
            } catch (e) {
                console.error("❌ Extraction Error:", e);
                alert("Extraction failed: " + e.message);
            }
        });
        sendResponse({ status: 'started' });
    }

    return true; // Keep message channel open for async response
});

console.log('✅ Enhanced Content Script Ready!');
console.log('📊 Available instances:', {
    elementPicker: !!window.elementPicker,
    containerDetector: !!window.containerDetector,
    dataExtractor: !!window.dataExtractor
});