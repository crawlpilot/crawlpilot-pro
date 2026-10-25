/**
 * Plain-language selector grades (the two-layer wording from thenos's recipe studio): a selector is
 * Strong, Fragile or Broken, with one sentence of why, and the kind of evidence it leans on.
 */
import { AUTHOR_ATTRIBUTES, isHashClass, isStableId, isUnstableClass } from './stability';
import { looksLikeXPath } from './resolve';

export type SelectorGrade = 'strong' | 'fragile' | 'broken';

export type EvidenceFamily = 'test id' | 'id' | 'label' | 'attribute' | 'text' | 'class' | 'structure';

export interface GradedSelector {
    grade: SelectorGrade;
    reason: string;
    family: EvidenceFamily;
}

const TEST_IDS = AUTHOR_ATTRIBUTES.filter(a => a !== 'itemprop').join('|');
const TEST_ATTR = new RegExp(`\\[(${TEST_IDS})\\b|@(${TEST_IDS})\\b`);
const LABEL_ATTR = /\[(aria-label|title|alt|name|placeholder)\b|@(aria-label|title|alt|name|placeholder)\b|\[role\b|@role\b|\[itemprop\b|@itemprop\b/;
const OTHER_ATTR = /\[[a-z-]+[\]=~^$*|]|@[a-z-]+/i;
const TEXT_TEST = /text\(\)|normalize-space\(|contains\(string\(|:has-text\(|:contains\(/;
const POSITION_CSS = /:nth-(child|of-type|last-child|last-of-type)\(/;
const XPATH_POSITION = /\[\d+\]/g;

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
    if (ids.some(id => !isStableId(id))) {
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

/** Top-level steps of a selector, target last: CSS compounds or XPath location steps (brackets, parens and quotes kept whole). */
function stepsOf(selector: string): string[] {
    const xpath = looksLikeXPath(selector);
    const out: string[] = [];
    let current = '';
    let depth = 0;
    let quote = '';
    for (const ch of selector) {
        if (quote) { if (ch === quote) quote = ''; current += ch; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '[' || ch === '(') depth++;
        else if ((ch === ']' || ch === ')') && depth > 0) depth--;
        const split = depth === 0 && (xpath ? ch === '/' : ch === ' ' || ch === '>' || ch === '+' || ch === '~');
        if (split) { if (current.trim()) out.push(current.trim()); current = ''; continue; }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out.filter(step => step !== ':scope' && step !== '.' && step !== '(');
}

/** What one step costs: a test id 1, an id 150, an attribute value 200, its presence 350, a class 400 (+100 per extra), a tag 600. */
function stepCost(step: string): number {
    const classes = (step.match(/\.-?[_a-zA-Z][\w-]*/g) || []).length + (step.match(/contains\(concat\(/g) || []).length;
    if (TEST_ATTR.test(step)) return 1;
    if (/#-?[_a-zA-Z]|@id=/.test(step)) return 150;
    if (/\[[\w-]+[~|^$*]?=|@[\w-]+=/.test(step.replace(/@class=/g, ''))) return 200;
    if (/\[[\w-]+\]|\[@[\w-]+\]/.test(step)) return 350;
    if (classes > 0) return 400 + 100 * (classes - 1);
    return 600;
}

/**
 * What a selector costs to keep, lowest first (after Playwright's codegen): the target step's own
 * cost (`stepCost`), plus 50 and a tenth of its cost for each scope step above it, plus 10,000 per
 * position. A selector that names what an element is is cheap; one that says where it sits is dear.
 */
export function selectorCost(selector: string): number {
    const steps = stepsOf(selector.trim());
    const target = steps.pop() ?? '';
    const positions = (selector.match(/:nth-(child|of-type)\(|(?<!-sibling::[\w*-]+)\[\d+\]/g) || []).length;
    return stepCost(target) + steps.reduce((sum, step) => sum + 50 + stepCost(step) / 10, 0) + 10_000 * positions;
}

/** The kind of evidence a selector rests on (`test id`, `id`, `label`, `attribute`, `text`, `class`, `structure`). */
export function selectorFamily(selector: string): EvidenceFamily {
    return familyOf(selector);
}
