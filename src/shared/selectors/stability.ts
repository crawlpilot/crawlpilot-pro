/**
 * Returns true for CSS classes that are structurally unstable:
 * Tailwind utilities, versioned layout slugs, state classes, generated prefixes.
 * Used across all selector strategies as the single source of truth.
 */
/** Whole-class state words beyond the core set (show/fade from Bootstrap, validation states). */
const STATE_WORDS = new Set([
    'show', 'shown', 'hide', 'enabled', 'focused', 'loaded', 'error', 'invalid', 'valid',
    'checked', 'expanded', 'collapsed', 'in', 'fade',
]);

export function isUnstableClass(c: string): boolean {
    if (!c || c.length < 2) return true;
    // Responsive / state variant prefixes  (sm:, hover:, dark:, focus:)
    if (c.includes(':')) return true;
    // Tailwind JIT / v4 arbitrary value classes: [--border-width:1px], [&>*:hover]:z-10
    if (c.startsWith('[') || c.startsWith('(') || c.startsWith('*')) return true;
    // Tailwind arbitrary values embedded in class: w-[100px], max-[calc(100%-1rem)]
    if (/[\[\]()]/.test(c)) return true;
    // Purely numeric
    if (/^\d/.test(c)) return true;
    // Versioned layout slugs: ss26, ab12, -v2-, -v3-
    if (/[_-][a-z]{1,4}\d{2,}([_-]|$)/.test(c)) return true;
    if (/[_-]v\d+[_-]/.test(c)) return true;
    // layout-* are always structural / versioned
    if (/^layout-/.test(c)) return true;
    // Short sizing utilities: w-4, h-8, p-2, m-0, gap-3, col-3
    if (/^[a-z]{1,3}-\d/.test(c)) return true;
    // Tailwind spacing  (mx-, py-, pt-, ps-, pe-)
    if (/^[mp][xytrblse]?-/.test(c)) return true;
    // Tailwind sizing
    if (/^(w|h|min-w|min-h|max-w|max-h|size)-/.test(c)) return true;
    // Tailwind layout keywords
    if (/^(flex|grid|block|inline|hidden|visible|float|clear|contents|flow|box|table|columns|break|isolate|object|overscroll|overflow|static|fixed|absolute|relative|sticky)(-|$)/.test(c)) return true;
    // Tailwind flex/grid children
    if (/^(grow|shrink|basis|order|justify|items|content|self|gap|space|place)(-|$)/.test(c)) return true;
    // Tailwind typography
    if (/^(text-[a-z]|font-|leading-|tracking-|indent-|whitespace-|uppercase|lowercase|capitalize|truncate|antialiased)/.test(c)) return true;
    // Tailwind colors
    if (/^(bg-|border-[a-z]|from-|via-|to-|ring-|shadow-[a-z]|fill-|stroke-)/.test(c)) return true;
    // Tailwind borders & effects
    if (/^(border|rounded|ring|divide|outline|shadow|opacity|blur|brightness|contrast|grayscale|invert|saturate|backdrop)(-|$)/.test(c)) return true;
    // Tailwind transitions / transforms
    if (/^(transition|duration|ease|delay|animate|scale|rotate|translate|skew|transform|will-change)(-|$)/.test(c)) return true;
    // Tailwind misc
    if (/^(cursor|select|resize|scroll|snap|touch|appearance|pointer|sr-|list-|decoration-)/.test(c)) return true;
    // Generated: styled-components, CSS modules
    if (/^(sc-|css-|_[A-Z])/.test(c)) return true;
    // Design-system spacing tokens (ito-padding-vertical-16, fr-ec-mb-spacing-02)
    if (/(^|[-_])(padding|margin|spacing)[-_]/.test(c)) return true;
    // Pure state words
    if (/^(active|hover|selected|focus|current|visible|hidden|open|closed|disabled|loading)$/.test(c)) return true;
    if (STATE_WORDS.has(c.toLowerCase())) return true;
    // State as a suffix / BEM modifier (a-expander-content-expanded, panel--collapsed, tab_selected)
    if (/[-_](expanded|collapsed|active|selected|open|opened|closed|checked|disabled|loading|visible|hidden)$/.test(c)) return true;
    // State as a prefix (is-open, has-error)
    if (/^(is|has)-/.test(c)) return true;
    // Design-system utilities: Amazon a-size-*/a-spacing-*/aok-*, Bootstrap d-* display helpers.
    // Bootstrap col-* is deliberately NOT here: product grids often key on .col-md-4 items.
    if (/^(a-(size|spacing|color|text|font)-|aok-|d-(none|block|flex|inline|grid|table|contents)$)/.test(c)) return true;
    // Design system namespace prefixes (e.g. zds-layout-desktop, mds-grid-main)
    if (/^[a-z]{2,4}-(layout|container|wrapper|main|content|page|section|view|header|footer|sidebar|panel|grid)/.test(c)) return true;
    // Responsive/variant suffixes (e.g. product-detail-view-std, card-desktop, layout-compact)
    if (/-(desktop|mobile|tablet|std|alt|wide|narrow|full|compact|primary|secondary|small|large)(-|$)/.test(c)) return true;
    return false;
}

/**
 * Returns true if the class is a build-generated content-hash class:
 *   Emotion: css-[4-10 lowercase alnum]  e.g. css-dy3i81, css-1mbp38s
 *   styled-components: sc-[4-10 alnum]
 *   Obfuscated atomic CSS (LinkedIn 2026 web, some Meta surfaces): bare hex tokens,
 *   optionally underscore-prefixed  e.g. _75228706, e6d1c6b3, fee11784
 *
 * These are deterministic per build (hash of the CSS string), not runtime IDs.
 * Safe to use in majority-vote list selectors; NOT safe for single-element uniqueness,
 * and NOT safe to persist in a saved recipe — they change on every redeploy.
 */
export function isHashClass(c: string): boolean {
    if (/^(css|sc)-[A-Za-z0-9]{4,10}$/.test(c)) return true;
    // Framework-scoped hashes: jsx-123abc, svelte-xyz123, tw-…
    if (/^(jsx|emotion|styled|svelte|astro|makeStyles|tw)-[A-Za-z0-9_-]{4,}$/.test(c)) return true;
    // CSS modules: Button__root___1a2b3
    if (/^[A-Za-z0-9]+__[A-Za-z0-9]+___[A-Za-z0-9_-]{5}$/.test(c)) return true;
    const hasDigit = /\d/.test(c);
    // CSS modules short form: price_x7f2a. Requires a digit so snake_case names
    // (product_title, card_image) are never mistaken for hashes.
    if (hasDigit && /^[a-z][A-Za-z]+_[a-z0-9]{5,8}$/.test(c)) return true;
    // Underscore-prefixed build token: _3Ab4F
    if (/^_[A-Za-z0-9]{4,}$/.test(c) && hasDigit && /[A-Za-z]/.test(c)) return true;
    // Bare hex hash: require a digit so real words spelled in hex letters
    // ("facade", "decade") never match.
    if (/^_?[0-9a-f]{6,12}$/.test(c)) return hasDigit;
    // Mixed-case alphanumeric build token (x7Gh2KpQ): needs a digit and both cases.
    return /^_?[A-Za-z0-9]{6,}$/.test(c) && hasDigit && /[A-Z]/.test(c) && /[a-z]/.test(c);
}

/** Attributes that carry the element's current state: never embedded in a selector. */
const STATE_ATTRIBUTES = new Set([
    'aria-expanded', 'aria-selected', 'aria-pressed', 'aria-current', 'aria-hidden', 'aria-checked',
    'data-state', 'data-open', 'data-active', 'data-selected', 'data-expanded',
    'open', 'checked', 'disabled', 'hidden', 'style', 'class',
]);

/**
 * Returns true if it is safe to embed the attribute value directly in a selector.
 * When false, callers should use existence-only [attr] or skip the attribute entirely.
 */
export function isStableAttributeValue(attr: string, value: string): boolean {
    if (!value) return false;

    // State attributes describe the element's current state, not what it is
    if (STATE_ATTRIBUTES.has(attr)) return false;
    // Serialised content (JSON, quoted strings, runs of whitespace) is data, not a name
    if (/[{}\[\]"']|\s{2,}/.test(value)) return false;

    // Always instance-specific — never embed the value
    const alwaysSkip = new Set([
        'data-id', 'data-entity-urn', 'data-urn', 'data-li-id', 'data-index',
        'data-key', 'data-reactid', 'href', 'src', 'id'
    ]);
    if (alwaysSkip.has(attr)) return false;

    // Vocabulary words — always safe to embed
    const alwaysUse = new Set(['role', 'type', 'rel', 'itemprop', 'method', 'target']);
    if (alwaysUse.has(attr)) return true;

    // Test-ID attributes are explicitly set for automation stability — always embed their value.
    // Even long or hyphen-heavy values like "details-and-description-heading" are stable by design.
    const testIdAttrs = new Set(['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-component', 'data-control-name']);
    if (testIdAttrs.has(attr)) {
        // Only reject if it looks like a runtime instance value
        if (/[:/@#?=]/.test(value)) return false;
        if (/\d{4,}/.test(value)) return false; // 4+ consecutive digits = runtime ID (e.g. "item-12345")
        return true;
    }

    // Reject if contains digits (ID, count, timestamp)
    if (/\d/.test(value)) return false;
    // Reject URL/URN characters
    if (/[:/@#?=]/.test(value)) return false;
    // Reject long values (names, descriptions)
    if (value.length > 60) return false;
    // Reject multi-word with uppercase (proper noun / human-readable label)
    if (/\s/.test(value) && /[A-Z]/.test(value.slice(1))) return false;

    return true;
}

/**
 * Returns true if a selector string is volatile: it embeds a CSS-in-JS hash class
 * (css-*, sc-*) or a positional pseudo-class (:nth-child/:nth-of-type). Such selectors
 * are only safe as last-resort fallback entries in a persisted chain, never as the
 * primary/first entry, since they rot across redeploys or DOM reorders.
 */
export function isVolatileSelector(selector: string): boolean {
    if (!selector) return true;
    if (/:nth-(child|of-type)\(/.test(selector)) return true;
    const classTokens = selector.match(/\.[a-zA-Z0-9_-]+/g) || [];
    return classTokens.some(token => isHashClass(token.slice(1)));
}

/**
 * Filters volatile entries (hash classes, positional selectors) out of a chain before
 * it's persisted in a saved recipe, so recipes survive CSS-in-JS redeploys. If every
 * entry is volatile, keeps them all — a volatile chain is still better than an empty one.
 */
export function filterPersistableChain<T extends { selector: string }>(chain: T[] | undefined): T[] | undefined {
    if (!chain || chain.length === 0) return chain;
    const stable = chain.filter(entry => !isVolatileSelector(entry.selector));
    return stable.length > 0 ? stable : chain;
}
