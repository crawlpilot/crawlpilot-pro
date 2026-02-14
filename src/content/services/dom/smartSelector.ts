
export function generateSmartSelector(el: HTMLElement): string {
    if (!el || !el.tagName) return '';

    // 0. Use ID if available and valid (Strongest)
    if (el.id) {
        try {
            const escapedId = CSS.escape(el.id);
            if (document.querySelectorAll(`#${escapedId}`).length === 1) {
                // Check if ID looks like a stable identifier (not random hash)
                if (!el.id.match(/^[0-9]+$/) && !el.id.match(/^(css|sc)-/)) {
                    return `#${escapedId}`;
                }
            }
        } catch (e) { }
    }

    // 1. Path-based generation with Semantic Class Prioritization
    const path: string[] = [];
    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && current !== document.body && depth < 10) {
        let selector = current.tagName.toLowerCase();

        // Add classes if available
        if (current.className && typeof current.className === 'string') {
            const classes = current.className.split(/\s+/).filter(c => {
                if (!c) return false;
                const lower = c.toLowerCase();
                // Filter out unstable/layout/utility classes
                if (lower.match(/^(col-|row-|grid-|flex-|uk-|mui-|fa-|btn-|icon-)/)) return false; // Framework prefixes
                if (lower.match(/^[0-9]/) || lower.length < 3) return false; // Too short or starts with number
                if (lower.includes(':') || lower.includes('/') || lower.includes('!')) return false; // Escaped chars

                // State modifiers
                if (['active', 'hover', 'selected', 'focus', 'current', 'open', 'closed', 'disabled'].some(bad => lower.includes(bad))) return false;

                // Generic structural wrappers
                if (['wrapper', 'container', 'content', 'inner', 'outer', 'box', 'control', 'group'].includes(lower)) return false;
                if (['clearfix', 'clear', 'hidden', 'visible'].includes(lower)) return false;

                // Random generated looking (e.g. sc-123kd, css-123)
                if (lower.match(/^(css|sc)-[a-zA-Z0-9]+$/)) return false;

                return true;
            });

            // Prioritize semantic classes
            const semanticKeywords = ['title', 'header', 'price', 'name', 'desc', 'image', 'thumb', 'link', 'item', 'card', 'product', 'article', 'post', 'comment', 'text', 'author', 'date', 'time', 'tag', 'label', 'value', 'data', 'info', 'meta'];

            const meaningfulClasses = classes.filter(c =>
                semanticKeywords.some(keyword => c.toLowerCase().includes(keyword))
            );

            // Strategy: Use meaningful classes if available, otherwise fallback to specific non-generic ones
            let classesToUse: string[] = [];

            if (meaningfulClasses.length > 0) {
                // Use all meaningful classes to be specific, but limit to 3 to avoid brittleness
                classesToUse = meaningfulClasses.slice(0, 3);
            } else {
                // If no clear semantic classes, take the longest/most specific looking ones (limit 2)
                classesToUse = classes.slice(0, 2);
            }

            if (classesToUse.length > 0) {
                selector += `.${classesToUse.join('.')}`;
            }
        }

        // Structural pseudo-class fallback if needed (only if no ID or distinct classes)
        // Check uniqueness with current selector so far
        // For 'current' element, we always want uniqueness if possible.
        // For parents, we just need path.

        // If selector is just tag (or tag.generic), we need nth-of-type
        if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children);
            const sameTagSiblings = siblings.filter(s => s.tagName === current!.tagName);

            if (sameTagSiblings.length > 1) {
                // Optimization: If we have a GOOD class, check if it's unique among siblings.
                // If so, we don't need nth-of-type.
                let needsNth = true;
                if (current.className && typeof current.className === 'string') {
                    // Check if our generated selector part discriminates it
                    // Simplified check:
                    if (selector.includes('.')) {
                        // Count siblings matching this selector part
                        // Note: 'selector' var holds "tag.class.class"
                        // We need to check if any other sibling matches this
                        const matchingSiblings = sameTagSiblings.filter(s => {
                            if (s === current) return true;
                            // Check if 's' has all the classes in 'selector'
                            // This is rough but likely good enough
                            // Parse classes from selector
                            const selectorClasses = selector.split('.').slice(1);
                            if (selectorClasses.length > 0) {
                                return selectorClasses.every(cls => s.classList.contains(cls));
                            }
                            return false;
                        });
                        if (matchingSiblings.length === 1) {
                            needsNth = false;
                        }
                    }
                }

                if (needsNth) {
                    const index = sameTagSiblings.indexOf(current);
                    selector += `:nth-of-type(${index + 1})`;
                }
            }
        }

        path.unshift(selector);
        current = current.parentElement;
        depth++;
    }

    return path.join(' > ');
}
