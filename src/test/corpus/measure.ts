/**
 * Measures what a pick would store on a corpus page: the list's container and item chains, its
 * fields, single-element pairs and a Next control's chain. The numbers that matter for a run:
 * does the first entry name the target (or exactly the items), is it positional, does it embed
 * an instance value, and do the fields read the annotated values.
 */
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { resolve } from 'path';
import { controlLocators, elementLocators, listLocators } from '../../content/services/selectors/specs';
import { keepItems } from '../../content/services/extraction/items';
import { inferFields, readRow } from '../../content/services/extraction/fields';
import { readValue } from '../../content/services/extraction/atoms';
import { gradeSelector } from '../../shared/selectors/grade';
import { looksLikeXPath } from '../../shared/selectors/resolve';
import { filterPersistableChain } from '../../shared/selectors/stability';
import type { PageTargets } from './targets';

const FIXTURES = resolve(__dirname, '../fixtures');
const CHAIN_SHOWN = 3;

export function loadPage(file: string) {
    const raw = readFileSync(resolve(FIXTURES, file));
    document.documentElement.innerHTML = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
}

function query(selector: string, root: ParentNode = document): Element[] {
    try {
        if (looksLikeXPath(selector)) {
            const r = document.evaluate(selector, root as Node, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i) as Element);
        }
        return Array.from(root.querySelectorAll(selector));
    } catch {
        return [];
    }
}

const POSITIONAL = /:nth-(child|of-type)\(|\[\d+\]/;
/** An instance's own value inside a selector: an item id, a link or image address, a long number, a mixed-case token. */
const INSTANCE_VALUE = /\[(data-(item-id|asin|sku|id|dca-id)|id|href|src)=|=['"][^'"]*\d{4,}|=['"](?=[^'"]*\d)(?=[^'"]*[A-Z])[A-Za-z0-9]{8,}['"]/;

function flags(selector: string) {
    return {
        ...(POSITIONAL.test(selector) ? { positional: true } : {}),
        ...(INSTANCE_VALUE.test(selector) ? { instanceValue: true } : {}),
    };
}

const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function measureList(t: PageTargets['list']) {
    const container = document.querySelector(t.container) as HTMLElement;
    const truth = query(t.items, container) as HTMLElement[];
    const children = Array.from(container.children) as HTMLElement[];
    const kept = keepItems(children);
    const locators = listLocators(container, children, truth[0]);
    const persisted = filterPersistableChain(locators.items) ?? [];

    const itemEntry = (selector: string) => {
        const matched = query(selector, container);
        const set = new Set(matched);
        return {
            selector,
            matches: matched.length,
            exact: matched.length === truth.length && truth.every(e => set.has(e)),
            ...flags(selector),
        };
    };
    const containerEntry = (selector: string) => {
        const matched = query(selector);
        return { selector, unique: matched.length === 1 && matched[0] === container, ...flags(selector) };
    };

    const { columns } = inferFields(truth);
    const rows = truth.map(r => readRow(r, columns));
    const fields = t.fields.map(f => {
        const expected = truth.map(r => r.querySelector(f.at)).map(el => (el ? norm(readValue(el, f.attr)) : ''));
        const withValue = expected.filter(Boolean).length;
        let best: { column: string; selector: string; matched: number } | null = null;
        for (const col of columns) {
            const matched = rows.filter((row, i) => expected[i] && norm(row[col.id]) === expected[i]).length;
            if (matched > 0 && (!best || matched > best.matched)) {
                best = { column: col.name, selector: col.reader?.chain[0] ?? '', matched };
            }
        }
        return { field: f.name, rowsWithValue: withValue, readBy: best ? `${best.column} ← ${best.selector} (${best.matched}/${withValue})` : null };
    });

    return {
        items: truth.length,
        children: children.length,
        keptAsItems: kept.length,
        container: locators.container.slice(0, CHAIN_SHOWN).map(c => containerEntry(c.selector)),
        itemChain: locators.items.slice(0, CHAIN_SHOWN).map(c => itemEntry(c.selector)),
        itemChainLength: locators.items.length,
        firstExactAt: locators.items.findIndex(c => itemEntry(c.selector).exact),
        persistedFirst: persisted[0] ? itemEntry(persisted[0].selector) : null,
        columns: columns.map(c => `${c.name} ← ${c.reader?.chain[0]}`),
        fields,
    };
}

function measureElement(at: string) {
    const target = document.querySelector(at) as HTMLElement;
    const { css, xpath } = elementLocators(target);
    const entry = (selector: string) => {
        const matched = query(selector);
        return {
            selector,
            namesTarget: matched.length === 1 && matched[0] === target,
            grade: gradeSelector(selector, matched.length, 1).grade,
            ...flags(selector),
        };
    };
    return { css: entry(css), xpath: entry(xpath) };
}

function measureControl(at: string) {
    const target = document.querySelector(at) as HTMLElement;
    const chain = controlLocators(target);
    const invalid = chain.filter(c => {
        try {
            if (looksLikeXPath(c.selector)) document.evaluate(c.selector, document, null, XPathResult.ANY_TYPE, null);
            else document.querySelector(c.selector);
            return false;
        } catch {
            return true;
        }
    }).length;
    return {
        chainLength: chain.length,
        invalid,
        first: chain.slice(0, CHAIN_SHOWN).map(c => {
            const matched = query(c.selector);
            return { selector: c.selector, namesTarget: matched.length === 1 && matched[0] === target, ...flags(c.selector) };
        }),
    };
}

export function measurePage(t: PageTargets) {
    loadPage(t.file);
    return {
        list: measureList(t.list),
        elements: Object.fromEntries(t.elements.map(e => [e.name, measureElement(e.at)])),
        ...(t.next ? { next: measureControl(t.next) } : {}),
    };
}

/** Totals over the corpus: what each phase must move, never back. */
export function summarize(report: Record<string, ReturnType<typeof measurePage>>) {
    const pages = Object.values(report);
    const elements = pages.flatMap(p => Object.values(p.elements).flatMap(e => [e.css, e.xpath]));
    const fields = pages.flatMap(p => p.list.fields);
    return {
        pages: pages.length,
        itemFirstExact: pages.filter(p => p.list.itemChain[0]?.exact).length,
        itemPersistedFirstExact: pages.filter(p => p.list.persistedFirst?.exact).length,
        containerFirstNamed: pages.filter(p => p.list.container[0]?.unique && !p.list.container[0]?.positional).length,
        elementSelectors: elements.length,
        elementNamesTarget: elements.filter(e => e.namesTarget).length,
        elementStrong: elements.filter(e => e.grade === 'strong').length,
        elementPositional: elements.filter(e => e.positional).length,
        elementInstanceValue: elements.filter(e => e.instanceValue).length,
        fields: fields.length,
        fieldsRead: fields.filter(f => f.readBy).length,
    };
}
