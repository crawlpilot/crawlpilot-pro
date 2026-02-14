
export class LegacySelectorGenerator {

    /**
     * Generates a list of robust CSS selectors for the given element.
     * Ported from sidepanel-readable.js p(e)
     */
    static generateCssSelectors(element: HTMLElement): string[] {
        if (!element) return [];
        const results: string[] = [];

        // Helper to validate uniqueness
        const isValid = (selector: string) => {
            try {
                const found = document.querySelectorAll(selector);
                return found.length === 1 && found[0] === element;
            } catch (e) {
                return false;
            }
        };

        const id = element.id;
        const className = element.className;
        const tagName = element.tagName.toLowerCase();

        // 1. ID Selector
        if (id) {
            const selector = `#${CSS.escape(id)}`;
            if (isValid(selector)) results.push(selector);
        }

        // 2. Class Combinations
        if (className && typeof className === 'string') {
            const classes = className.split(/\s+/).filter(c => c && !c.includes(':'));

            // Single class combinations
            for (let i = 1; i <= classes.length; i++) {
                const combined = `${tagName}.${classes.slice(0, i).join('.')}`;
                if (isValid(combined) && !results.includes(combined)) results.push(combined);
            }

            // Individual classes
            for (const cls of classes) {
                const selector = `.${cls}`;
                if (isValid(selector) && !results.includes(selector)) results.push(selector);
            }
        }

        // 3. Attributes
        const attributes = ["data-testid", "role", "aria-label", "name", "title", "alt"];
        for (const attr of attributes) {
            try {
                if (element.hasAttribute(attr)) {
                    const val = element.getAttribute(attr);
                    if (val) {
                        const selector = `${tagName}[${attr}="${CSS.escape(val)}"]`;
                        if (isValid(selector) && !results.includes(selector)) results.push(selector);
                    }
                }
            } catch (e) { }
        }

        // 4. Ancestor Path (up to 3 levels)
        let curr = element;
        let depth = 0;
        let path = "";

        while (curr && depth < 3 && curr !== document.body) {
            const currTag = curr.tagName.toLowerCase();
            const currId = curr.id;
            const currClass = curr.className;

            let selectorPart = currTag;
            if (currId) {
                selectorPart = `#${CSS.escape(currId)}`;
            } else if (currClass && typeof currClass === 'string') {
                const firstClass = currClass.split(/\s+/)[0];
                if (firstClass && !firstClass.includes(':')) {
                    selectorPart = `${currTag}.${firstClass}`;
                }
            }

            path = selectorPart + (path ? " > " + path : "");

            if (isValid(path) && !results.includes(path)) {
                results.push(path);
                break;
            }

            curr = curr.parentElement!;
            depth++;
        }

        // 5. Nth-of-type Logic with Parents (up to 5 levels)
        if (results.length < 3) {
            try {
                let fullPath = "";
                curr = element;
                depth = 0;

                while (curr && curr !== document.body && depth < 5) {
                    const tag = curr.tagName.toLowerCase();
                    // Basic nth-of-type check
                    const siblings = Array.from(curr.parentElement?.children || []);
                    const sameTag = siblings.filter(s => s.tagName.toLowerCase() === tag);

                    if (sameTag.length > 1) {
                        const index = sameTag.indexOf(curr);
                        fullPath = `${tag}:nth-of-type(${index + 1})${fullPath ? " > " + fullPath : ""}`;
                    } else {
                        fullPath = `${tag}${fullPath ? " > " + fullPath : ""}`;
                    }

                    if (isValid(fullPath) && !results.includes(fullPath)) {
                        results.push(fullPath);
                        break;
                    }
                    curr = curr.parentElement!;
                    depth++;
                }
            } catch (e) { }
        }

        // Fallback: Full Path (body > div > div...)
        if (results.length === 0) {
            let curr: HTMLElement | null = element;
            let path = "";
            while (curr && curr.nodeType === 1) {
                let selector = curr.tagName.toLowerCase();
                if (curr.parentElement) {
                    const siblings = Array.from(curr.parentElement.children);
                    const sameTag = siblings.filter(s => s.tagName.toLowerCase() === selector);
                    if (sameTag.length > 1) {
                        const idx = sameTag.indexOf(curr) + 1;
                        selector += `:nth-of-type(${idx})`;
                    }
                }
                path = selector + (path ? " > " + path : "");
                if (curr === document.body) break;
                curr = curr.parentElement;
            }
            if (path) results.push(path);
        }

        return results.slice(0, 3);
    }

    /**
     * Generates a list of robust XPath selectors for the given element.
     * Ported from sidepanel-readable.js f(t)
     */
    static generateXPathSelectors(element: HTMLElement): string[] {
        if (!element) return [];
        const results: string[] = [];

        // Helper to validate uniqueness
        const isValid = (xpath: string) => {
            try {
                const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                return result.snapshotLength === 1 && result.snapshotItem(0) === element;
            } catch (e) {
                return false;
            }
        };

        // Helper specifically for validation check used in original code 'h(t, type)'
        const addIfValid = (xpath: string) => {
            if (isValid(xpath)) {
                // We might check if it's already in results, though original pushes freely then slices
                if (!results.includes(xpath)) results.push(xpath);
                return true;
            }
            return false;
        };

        const tagName = element.tagName.toLowerCase();
        const id = element.id;
        const className = element.className;
        const textContent = element.textContent || "";
        const text = textContent.trim();

        // Smart Logic Block (Enabled by default as per 'if (e)' assumption)
        if (true) {
            const classList = (className && typeof className === 'string') ? className.split(/\s+/).filter(c => c && !c.includes(':')) : [];
            const attributes: { name: string, value: string, priority: number }[] = [];

            // Collect Attributes
            try {
                const interestingAttrs = ["href", "data-testid", "role", "aria-label", "name", "title", "placeholder", "type", "value"];
                if (element.attributes) {
                    for (let i = 0; i < element.attributes.length; i++) {
                        const attr = element.attributes[i];
                        if (attr.name.startsWith("data-") && attr.value && attr.value.trim().length > 0) {
                            attributes.push({ name: attr.name, value: attr.value, priority: 1 });
                        }
                    }
                    for (const name of interestingAttrs) {
                        if (element.hasAttribute(name)) {
                            const val = element.getAttribute(name);
                            if (val && val.trim().length > 0) {
                                attributes.push({ name: name, value: val, priority: name === "href" ? 2 : 3 });
                            }
                        }
                    }
                    attributes.sort((a, b) => a.priority - b.priority);
                }
            } catch (e) { }

            // 1. Text Content XPaths
            if (text.length > 0) {
                // contains string
                let xpath = `//${tagName}[contains(string(), "${this.escapeQuotes(text)}")]`;
                addIfValid(xpath);

                if (results.length === 0) {
                    xpath = `//${tagName}[text()="${this.escapeQuotes(text)}"]`;
                    addIfValid(xpath);
                }
                if (results.length === 0) {
                    const shortText = text.substring(0, Math.min(30, text.length));
                    xpath = `//${tagName}[contains(text(), "${this.escapeQuotes(shortText)}")]`;
                    addIfValid(xpath);
                }

                // Text + Attributes
                if (results.length === 0 && attributes.length > 0) {
                    const candidates = attributes.filter(a => a.name.startsWith("data-") || a.name === "type" || a.name === "role");
                    const attrsToUse = candidates.length > 0 ? candidates : attributes.slice(0, 2);

                    for (const attr of attrsToUse) {
                        xpath = `//${tagName}[contains(string(), "${this.escapeQuotes(text)}") and @${attr.name}="${this.escapeQuotes(attr.value)}"]`;
                        if (addIfValid(xpath)) break;

                        xpath = `//${tagName}[text()="${this.escapeQuotes(text)}" and @${attr.name}="${this.escapeQuotes(attr.value)}"]`;
                        if (addIfValid(xpath)) break;
                    }
                }

                // Text + Class
                if (results.length === 0 && classList.length > 0) {
                    const validClasses = classList.filter(c => c.length > 3 && !/^[a-f0-9]{6,}$/i.test(c));
                    for (const cls of validClasses) {
                        xpath = `//${tagName}[contains(string(), "${this.escapeQuotes(text)}") and contains(@class, "${cls}")]`;
                        if (addIfValid(xpath)) break;
                    }
                }
            }

            // 2. Semantic Child Elements (SVG, aria-labels)
            if (results.length === 0) {
                const hints: { type: string, value: string }[] = [];
                try {
                    const svgs = element.querySelectorAll('svg');
                    for (let i = 0; i < svgs.length; i++) {
                        const svg = svgs[i];
                        const title = svg.getAttribute('title');
                        const role = svg.getAttribute('role');
                        if (title) hints.push({ type: 'svg-title', value: title });
                        if (role) hints.push({ type: 'svg-role', value: role });
                    }

                    const others = element.querySelectorAll('[aria-label], [title], [alt]');
                    for (let i = 0; i < others.length; i++) {
                        const el = others[i];
                        const ariaLabel = el.getAttribute('aria-label');
                        const title = el.getAttribute('title');
                        const alt = el.getAttribute('alt');
                        if (ariaLabel) hints.push({ type: 'aria-label', value: ariaLabel });
                        if (title) hints.push({ type: 'title', value: title });
                        if (alt) hints.push({ type: 'alt', value: alt });
                    }
                } catch (e) { }

                for (const hint of hints) {
                    const val = this.escapeQuotes(hint.value);
                    const candidates: string[] = [];

                    if (hint.type === 'svg-title') {
                        // Try combining with class if available for robustness
                        if (classList.length > 0) {
                            const cls = classList.find(c => c.length > 3);
                            if (cls) {
                                candidates.push(`//${tagName}[contains(@class, "${cls}") and .//svg[@title="${val}"]]`);
                            }
                        }
                        candidates.push(`//${tagName}[.//svg[@title="${val}"]]`);
                        candidates.push(`//${tagName}[.//*[@title="${val}"]]`);
                    } else if (hint.type === 'svg-role') {
                        if (classList.length > 0) {
                            const cls = classList.find(c => c.length > 3);
                            if (cls) {
                                candidates.push(`//${tagName}[contains(@class, "${cls}") and .//svg[@role="${val}"]]`);
                            }
                        }
                        candidates.push(`//${tagName}[.//svg[@role="${val}"]]`);
                    } else if (hint.type === 'aria-label') {
                        candidates.push(`//${tagName}[.//*[@aria-label="${val}"]]`);
                    } else if (hint.type === 'title') {
                        candidates.push(`//${tagName}[.//*[@title="${val}"]]`);
                    } else if (hint.type === 'alt') {
                        candidates.push(`//${tagName}[.//*[@alt="${val}"]]`);
                    }

                    // Test candidates
                    for (const xpath of candidates) {
                        if (addIfValid(xpath)) break;
                    }
                    if (results.length > 0) break;
                }
            }

            // 3. Class Combinations (Stable Class XPath)
            if (results.length === 0) {
                // Filter out random hashes (MD5, long random strings)
                const stableClasses = classList.filter(c =>
                    c.length > 1 &&
                    !c.includes(':') &&
                    !/^[a-f0-9]{32,}$/i.test(c) &&
                    !/^[A-Z0-9]{10,}$/i.test(c) && // Reduced 12->10 to be safer
                    !/^(css|sc)-/i.test(c) // Common css-in-js prefixes
                );

                // Single class
                for (const cls of stableClasses) {
                    addIfValid(`//${tagName}[contains(@class, "${cls}")]`);
                    if (results.length > 0) break;
                }

                // Two-class combination
                if (results.length === 0 && stableClasses.length >= 2) {
                    // Consecutive
                    for (let i = 0; i < Math.min(3, stableClasses.length - 1); i++) {
                        const c1 = stableClasses[i];
                        const c2 = stableClasses[i + 1];
                        addIfValid(`//${tagName}[contains(@class, "${c1}") and contains(@class, "${c2}")]`);
                        if (results.length > 0) break;
                    }

                    // Non-consecutive (skip 1)
                    if (results.length === 0) {
                        for (let i = 0; i < Math.min(2, stableClasses.length - 1); i++) {
                            for (let j = i + 2; j < Math.min(i + 4, stableClasses.length); j++) {
                                const c1 = stableClasses[i];
                                const c2 = stableClasses[j];
                                addIfValid(`//${tagName}[contains(@class, "${c1}") and contains(@class, "${c2}")]`);
                                if (results.length > 0) break;
                            }
                            if (results.length > 0) break;
                        }
                    }

                    // First + Last
                    if (results.length === 0 && stableClasses.length >= 3) {
                        const c1 = stableClasses[0];
                        const cn = stableClasses[stableClasses.length - 1];
                        addIfValid(`//${tagName}[contains(@class, "${c1}") and contains(@class, "${cn}")]`);
                    }
                }
            }

            // Helper for last() check
            const tryLast = (xpath: string) => {
                try {
                    const snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    if (snap.snapshotLength > 1 && snap.snapshotItem(snap.snapshotLength - 1) === element) {
                        const lastXpath = `(${xpath})[last()]`;
                        addIfValid(lastXpath);
                    }
                } catch (e) { }
            };

            // 4. Exact Class Match
            if (results.length === 0 && className && typeof className === 'string') {
                // Clean class name (remove newlines/excess spaces if needed, generally exact match)
                const cleanClass = className.trim().replace(/\s+/g, ' ');
                if (cleanClass) {
                    const exactClassXpath = `//${tagName}[@class="${this.escapeQuotes(cleanClass)}"]`;
                    if (!addIfValid(exactClassXpath)) {
                        tryLast(exactClassXpath);
                    }
                }
            }

            // 5. Element Attributes (Single & Pair)
            if (results.length === 0 && attributes.length > 0) {
                const bestAttrs = attributes.filter(a =>
                    a.name === 'id' ||
                    a.name.startsWith('data-') ||
                    ['type', 'role', 'name', 'aria-label', 'placeholder', 'title', 'alt'].includes(a.name)
                );

                // Single Attribute
                for (const attr of bestAttrs) {
                    addIfValid(`//${tagName}[@${attr.name}="${this.escapeQuotes(attr.value)}"]`);
                    if (results.length > 0) break;
                }

                // Pair Attributes (Stable)
                if (results.length === 0 && bestAttrs.length >= 2) {
                    const a1 = bestAttrs[0];
                    const a2 = bestAttrs[1];
                    addIfValid(`//${tagName}[@${a1.name}="${this.escapeQuotes(a1.value)}" and @${a2.name}="${this.escapeQuotes(a2.value)}"]`);
                }
            }
        }

        // 4. ID-based Relative Path
        if (results.length < 3) {
            let curr: HTMLElement | null = element;
            let relPath = "";
            // Walk up to find nearest ID
            while (curr && curr !== document.body) {
                if (curr !== element && curr.id) {
                    const idPath = `//*[@id="${this.escapeQuotes(curr.id)}"]${relPath}`;
                    if (addIfValid(idPath)) break;
                }

                // Build path for next iteration
                if (curr.parentElement) {
                    const siblings = Array.from(curr.parentElement.children);
                    const sameTag = siblings.filter(s => s.tagName === curr!.tagName);
                    const tag = curr.tagName.toLowerCase();
                    let step = `/${tag}`;
                    if (sameTag.length > 1) {
                        const idx = sameTag.indexOf(curr) + 1;
                        step += `[${idx}]`;
                    }
                    relPath = step + relPath;
                    curr = curr.parentElement;
                } else {
                    break;
                }
            }
        }

        // 5. Parent Context (up to 3 levels)
        if (results.length === 0) {
            let curr: HTMLElement | null = element;
            for (let i = 1; i <= 3; i++) {
                curr = curr.parentElement;
                if (!curr || curr === document.body) break;

                const pTag = curr.tagName.toLowerCase();
                const pId = curr.id;
                const pClass = curr.className;

                // Parent ID
                if (pId) {
                    if (addIfValid(`//*[@id="${this.escapeQuotes(pId)}"]//${tagName}`)) break;
                }

                // Parent Class
                if (pClass && typeof pClass === 'string') {
                    const pClasses = pClass.split(/\s+/).filter(c => c && !c.includes(':'));
                    for (const pc of pClasses) {
                        if (addIfValid(`//${pTag}[contains(@class, "${pc}")]//${tagName}`)) break;
                    }
                    if (results.length > 0) break;

                    // Parent Class + Child Position
                    // Helper to find index of element among siblings matching selector
                    // Original logic (lines 20941): //parent[class] // tag [index]
                    // Note: XPath index is 1-based relative to set. 
                    // But here we construct //parent//child[index].
                    // Simplify: if we are in parent context, we can try specific path
                    // Ignoring complex position logic for brevity unless critical
                }
            }
        }

        // 5. Sibling Context
        if (results.length === 0) {
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const idx = siblings.indexOf(element);

                // Following Sibling
                if (idx < siblings.length - 1) {
                    const next = siblings[idx + 1] as HTMLElement;
                    const nextTag = next.tagName.toLowerCase();
                    const nextText = (next.textContent || "").trim();
                    const nextClass = next.className;

                    if (nextText.length > 0 && nextText.length < 20) {
                        const safeText = this.escapeQuotes(nextText.substring(0, 10));
                        if (text.length > 0) {
                            addIfValid(`//${tagName}[text()="${this.escapeQuotes(text)}" and following-sibling::${nextTag}[contains(text(), "${safeText}")]]`);
                        } else {
                            addIfValid(`//${tagName}[following-sibling::${nextTag}[contains(text(), "${safeText}")]]`);
                        }
                    }

                    if (results.length === 0 && nextClass && typeof nextClass === 'string') {
                        const nc = nextClass.split(/\s+/)[0];
                        if (nc && nc.length > 2) {
                            if (text.length > 0) {
                                addIfValid(`//${tagName}[text()="${this.escapeQuotes(text)}" and following-sibling::${nextTag}[contains(@class, "${nc}")]]`);
                            } else {
                                addIfValid(`//${tagName}[following-sibling::${nextTag}[contains(@class, "${nc}")]]`);
                            }
                        }
                    }
                }

                // Preceding Sibling
                if (results.length === 0 && idx > 0) {
                    const prev = siblings[idx - 1] as HTMLElement;
                    const prevTag = prev.tagName.toLowerCase();
                    const prevText = (prev.textContent || "").trim();
                    const prevClass = prev.className;

                    if (prevText.length > 0 && prevText.length < 20) {
                        const safeText = this.escapeQuotes(prevText.substring(0, 10));
                        if (text.length > 0) {
                            addIfValid(`//${tagName}[text()="${this.escapeQuotes(text)}" and preceding-sibling::${prevTag}[contains(text(), "${safeText}")]]`);
                        } else {
                            addIfValid(`//${tagName}[preceding-sibling::${prevTag}[contains(text(), "${safeText}")]]`);
                        }
                    }

                    if (results.length === 0 && prevClass && typeof prevClass === 'string') {
                        const pc = prevClass.split(/\s+/)[0];
                        if (pc && pc.length > 2) {
                            if (text.length > 0) {
                                addIfValid(`//${tagName}[text()="${this.escapeQuotes(text)}" and preceding-sibling::${prevTag}[contains(@class, "${pc}")]]`);
                            } else {
                                addIfValid(`//${tagName}[preceding-sibling::${prevTag}[contains(@class, "${pc}")]]`);
                            }
                        }
                    }
                }
            }
        }

        // Fallback: ID (Original Link)
        if (results.length === 0 && id) {
            addIfValid(`//*[@id="${this.escapeQuotes(id)}"]`); // Original uses //*[@id=...]
        }

        // Fallback: Hierarchy
        // Fallback: Hierarchy
        if (results.length < 3) {
            let curr = element;
            let path = "";
            let depth = 0;
            while (curr && curr.nodeType === 1 && depth < 4) {
                let idx = 1;
                let sib = curr.previousElementSibling;
                while (sib) {
                    if (sib.tagName === curr.tagName) idx++;
                    sib = sib.previousElementSibling;
                }
                const tag = curr.tagName.toLowerCase();
                path = `/${tag}[${idx}]` + path;

                if (depth > 0) {
                    const fullXPath = `//${path.substring(1)}`;
                    if (isValid(fullXPath) && !results.includes(fullXPath)) {
                        results.push(fullXPath);
                        break;
                    }
                }

                if (curr === document.body) break;
                curr = curr.parentElement!;
                depth++;
            }

            if (results.length === 0 && path) {
                results.push(`//${path.substring(1)}`);
            }
        }

        return results.slice(0, 3);
    }

    private static escapeQuotes(str: string): string {
        return str.replace(/"/g, '\\"');
    }
}
