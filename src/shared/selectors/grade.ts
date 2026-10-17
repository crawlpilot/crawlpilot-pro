/**
 * Plain-language selector grades (the two-layer wording from thenos's recipe studio): a selector is
 * Strong, Fragile or Broken, with one sentence of why, and the kind of evidence it leans on.
 */
import { isHashClass, isUnstableClass } from './stability';
import { looksLikeXPath } from './resolve';

export type SelectorGrade = 'strong' | 'fragile' | 'broken';

export type EvidenceFamily = 'test id' | 'id' | 'label' | 'attribute' | 'text' | 'class' | 'structure';

export interface GradedSelector {
    grade: SelectorGrade;
    reason: string;
    family: EvidenceFamily;
}

const TEST_ATTR = /\[(data-testid|data-test-id|data-test|data-qa|data-cy|data-automation-id)\b|@(data-testid|data-test-id|data-test|data-qa|data-cy|data-automation-id)\b/;
const LABEL_ATTR = /\[(aria-label|title|alt|name|placeholder)\b|@(aria-label|title|alt|name|placeholder)\b|\[role\b|@role\b|\[itemprop\b|@itemprop\b/;
const OTHER_ATTR = /\[[a-z-]+[\]=~^$*|]|@[a-z-]+/i;
const TEXT_TEST = /text\(\)|normalize-space\(|contains\(string\(|:has-text\(|:contains\(/;
const POSITION_CSS = /:nth-(child|of-type|last-child|last-of-type)\(/;
const XPATH_POSITION = /\[\d+\]/g;
const GENERATED_ID = /^(ember|react|radix|headlessui|mui|rc-|uid|guid|__)|[-_]?(autoid|uuid|guid)[-_]|\d{4,}|:/i;

function classTokens(selector: string): string[] {
    const css = (selector.match(/\.[A-Za-z0-9_-]+/g) || []).map(t => t.slice(1));
    const xp = Array.from(selector.matchAll(/contains\(concat\(' ', normalize-space\(@class\), ' '\), ' ([^ ']+) '\)/g)).map(m => m[1]);
    const eq = Array.from(selector.matchAll(/@class=["']([^"']+)["']/g)).flatMap(m => m[1].split(/\s+/));
    return [...css, ...xp, ...eq];
}

function idTokens(selector: string): string[] {
    const css = (selector.match(/#[A-Za-z0-9_-]+/g) || []).map(t => t.slice(1));
    const xp = Array.from(selector.matchAll(/@id=["']([^"']+)["']|id\(["']([^"']+)["']\)/g)).map(m => m[1] || m[2]);
    return [...css, ...xp];
}

function familyOf(selector: string): EvidenceFamily {
    if (TEST_ATTR.test(selector)) return 'test id';
    if (idTokens(selector).length > 0) return 'id';
    if (LABEL_ATTR.test(selector)) return 'label';
    if (TEXT_TEST.test(selector)) return 'text';
    if (OTHER_ATTR.test(selector.replace(/@class\b/g, ''))) return 'attribute';
    if (classTokens(selector).length > 0) return 'class';
    return 'structure';
}

/**
 * @param matchCount how many elements the selector matches on the page now.
 * @param expected   how many it should match (1 for a single field); undefined to skip the check.
 */
export function gradeSelector(selector: string, matchCount: number, expected?: number): GradedSelector {
    const family = familyOf(selector);
    const s = selector.trim();
    if (matchCount === 0) return { grade: 'broken', reason: 'matches nothing on this page', family };

    const isXPath = looksLikeXPath(s);
    const positions = isXPath ? (s.match(XPATH_POSITION) || []).length : 0;
    if (isXPath && /^\/html|^\/body|^\/\//.test(s) && positions > 2) {
        return { grade: 'fragile', reason: 'an absolute path with positions; any layout change breaks it', family };
    }
    if (POSITION_CSS.test(s) || positions > 2) {
        return { grade: 'fragile', reason: 'depends on the element\'s position among its siblings', family };
    }
    const ids = idTokens(s);
    if (ids.some(id => GENERATED_ID.test(id))) {
        return { grade: 'fragile', reason: 'uses an id that looks generated per page load', family };
    }
    const classes = classTokens(s);
    if (classes.some(isHashClass)) {
        return { grade: 'fragile', reason: 'uses build-generated class names that change on every redeploy', family };
    }
    if (family === 'class' && classes.length > 0 && classes.every(c => isUnstableClass(c))) {
        return { grade: 'fragile', reason: 'relies only on styling classes, which sites rename often', family };
    }
    const depth = s.split(/\s*>\s*|\s+(?![^[]*\])|\/+/).filter(Boolean).length;
    if (family === 'structure' && depth > 3) {
        return { grade: 'fragile', reason: 'relies only on the page structure (tags nested in tags)', family };
    }
    if (expected !== undefined && matchCount !== expected) {
        return {
            grade: 'fragile',
            reason: expected === 1 ? `matches ${matchCount} elements, not just this one` : `matches ${matchCount} elements, expected ${expected}`,
            family,
        };
    }
    const why: Record<EvidenceFamily, string> = {
        'test id': 'found by a test id the site keeps stable for its own tests',
        id: 'found by its id',
        label: 'found by its label or role',
        attribute: 'found by a descriptive attribute',
        text: 'found by its text',
        class: 'found by a meaningful class name',
        structure: 'found by a short structural path',
    };
    return { grade: 'strong', reason: why[family], family };
}
