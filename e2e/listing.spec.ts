/**
 * The listing scorecard (`docs/plans/list-extraction-reliability-plan.md` L0): on each corpus listing,
 * pick the main results the way a user does and score what the List Extractor returns against
 * `listing-truth.ts`:
 *
 * - **items**: products picked ÷ products on the page, and rows matched to a product;
 * - per field, **found**: the value is in some column (possibly inside a longer text), and **exact**:
 *   one column holds just that value (a number for numbers), the structured result we want;
 * - **columns**: how many the pick made, and how many no truth field matches.
 *
 * The scores are compared with `listing-baseline.json`: a score below its baseline fails (a
 * regression); a score above it is printed so the baseline can be raised (`UPDATE_BASELINE=1`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, pickList } from './harness';
import { LISTINGS, type TruthField, type TruthRow } from './listing-truth';

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'listing-baseline.json');
const NUMERIC = new Set<TruthField>(['price', 'was_price', 'rating', 'review_count']);

const clean = (s: unknown) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A cell that is just a number: a number, or text that is one number with at most a currency sign, parentheses or a unit word. */
function exactNumber(cell: unknown): number | undefined {
    if (typeof cell === 'number') return cell;
    const m = /^\(?\s*[$€£₹]?\s*([\d,]*\.?\d+)\s*\)?$/.exec(clean(cell));
    return m ? Number(m[1].replace(/,/g, '')) : undefined;
}

function cellUrlPath(cell: unknown): string | undefined {
    try { return new URL(String(cell)).pathname.replace(/\/ref=.*$/, ''); } catch { return undefined; }
}

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const isUrl = (cell: unknown) => /^(\[\s*")?https?:\/\//i.test(String(cell));

function matches(field: TruthField, cell: unknown, truth: string | number, how: 'found' | 'exact'): boolean {
    if (cell === undefined || cell === null || cell === '') return false;
    // Only the URL field is read from URLs: an ID or model inside a product URL is not a column for it.
    if (field !== 'url' && isUrl(cell)) return false;
    if (how === 'found' && matches(field, cell, truth, 'exact')) return true;
    if (NUMERIC.has(field)) {
        if (how === 'exact') return exactNumber(cell) === truth;
        const plain = clean(cell).replace(/,/g, '');
        return new RegExp(`(^|[^\\d.])${String(truth).replace('.', '\\.')}(?![\\d])`).test(plain) || (Number.isInteger(truth) && plain.includes(`${(Number(truth) / 1000).toFixed(1)}k`));
    }
    if (field === 'url') return how === 'exact' ? cellUrlPath(cell) === truth : clean(decode(String(cell))).includes(clean(truth));
    return how === 'exact' ? clean(cell) === clean(truth) : clean(cell).includes(clean(truth));
}

interface Score {
    products: number;
    picked: number;
    matched: number;
    columns: number;
    unmatchedColumns: number;
    fields: Record<string, { truth: number; found: number; exact: number; column?: string; misses: string[] }>;
}

function score(truth: TruthRow[], rows: Record<string, unknown>[], columns: { id: string; name: string }[], picked: number): Score {
    // Each truth product to the extracted row holding its title (or its id).
    const pairs: [TruthRow, Record<string, unknown>][] = [];
    const used = new Set<number>();
    for (const t of truth) {
        const i = rows.findIndex((r, k) => !used.has(k) && Object.values(r).some(v => (t.id && clean(v) === clean(t.id)) || (t.title && clean(v).includes(clean(t.title)))));
        if (i >= 0) { used.add(i); pairs.push([t, rows[i]]); }
    }
    const fields: Score['fields'] = {};
    const usedColumns = new Set<string>();
    for (const field of [...new Set(truth.flatMap(t => Object.keys(t)))] as TruthField[]) {
        const withTruth = pairs.filter(([t]) => t[field] !== undefined && t[field] !== '');
        // Too few products have it to measure (Amazon's capture has one buy-box price).
        if (withTruth.length < 3) continue;
        let best = { column: undefined as string | undefined, found: 0, exact: 0 };
        for (const c of columns) {
            const found = withTruth.filter(([t, r]) => matches(field, r[c.id], t[field]!, 'found')).length;
            const exact = withTruth.filter(([t, r]) => matches(field, r[c.id], t[field]!, 'exact')).length;
            if (exact > best.exact || (exact === best.exact && found > best.found)) best = { column: c.name, found, exact };
        }
        if (best.column) usedColumns.add(best.column);
        const col = columns.find(c => c.name === best.column);
        const misses = col ? withTruth.filter(([t, r]) => !matches(field, r[col.id], t[field]!, 'exact')).slice(0, 3).map(([t, r]) => `${t[field]} ≠ ${JSON.stringify(r[col.id] ?? null)}`) : [];
        fields[field] = { truth: withTruth.length, found: best.found, exact: best.exact, column: best.column, misses };
    }
    return {
        products: truth.length, picked, matched: pairs.length,
        columns: columns.length, unmatchedColumns: columns.filter(c => !usedColumns.has(c.name)).length, fields,
    };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);

const results: Record<string, Score> = {};

for (const listing of LISTINGS) {
    test(`scorecard: ${listing.name}`, async ({ panel, ext, origin }) => {
        const page = await ext.newPage();
        await page.goto(`${origin}/corpus/${listing.name}`);
        const truth: TruthRow[] = await page.evaluate(([sel, fn]) => {
            const read = new Function(`return (${fn})`)() as (c: Element) => Record<string, unknown>;
            return Array.from(document.querySelectorAll(sel)).map(c => Object.fromEntries(Object.entries(read(c)).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v))));
        }, [listing.products, listing.read.toString()] as const);
        const products = truth.filter(t => t.title);

        const target = page.locator(listing.click).nth(listing.clickIndex ?? 0);
        await target.scrollIntoViewIfNeeded();
        const picked = await pickList(panel, page, `${listing.click} >> nth=${listing.clickIndex ?? 0}`);
        const rows = (picked.data?.items ?? []) as Record<string, unknown>[];
        const columns = (picked.data?.columns ?? []) as { id: string; name: string }[];
        const s = score(products, rows, columns, picked.count ?? rows.length);
        results[listing.name] = s;

        const lines = [
            `${listing.name}: picked ${s.picked} of ${truth.length} products (${products.length} rendered), ${s.matched} matched · ${s.columns} columns, ${s.unmatchedColumns} match no truth field`,
            ...Object.entries(s.fields).map(([f, v]) => `  ${f.padEnd(13)} found ${String(pct(v.found, v.truth)).padStart(3)}%  exact ${String(pct(v.exact, v.truth)).padStart(3)}%  of ${v.truth}  (${v.column ?? 'no column'})`),
        ];
        console.log(lines.join('\n'));
        // SHOW_COLUMNS=1: every column with the values of the first rows, to see what a pick made.
        if (process.env.SHOW_COLUMNS) {
            const unmatched = products.filter(t => !rows.some(r => Object.values(r).some(v => (t.id && clean(v) === clean(t.id)) || (t.title && clean(v).includes(clean(t.title))))));
            if (unmatched.length) console.log(`  unmatched: ${unmatched.map(t => `${t.id} ${String(t.title).slice(0, 40)}`).join(' · ')}`);
            Object.entries(s.fields).forEach(([f, v]) => { if (v.misses.length) console.log(`  ✗ ${f}: ${v.misses.join(' · ')}`); });
            console.log(columns.map(c => {
                const filled = rows.map(r => r[c.id]).filter(v => v !== undefined && v !== '');
                const sample = [...new Set(filled.map(v => JSON.stringify(v).slice(0, 60)))].slice(0, 3);
                return `  · ${c.name} [${filled.length}/${rows.length}] ${(c as { selector?: string }).selector ?? ''}\n      ${sample.join(' | ')}`;
            }).join('\n'));
        }
        await page.close();
    });
}

test.afterAll(() => {
    if (!Object.keys(results).length) return;
    const flat = (s: Score) => ({
        matched: pct(s.matched, s.products),
        ...Object.fromEntries(Object.entries(s.fields).flatMap(([f, v]) => [[`${f}.found`, pct(v.found, v.truth)], [`${f}.exact`, pct(v.exact, v.truth)]])),
    });
    const current = Object.fromEntries(Object.entries(results).map(([k, s]) => [k, flat(s)]));
    if (process.env.UPDATE_BASELINE) {
        const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
        fs.writeFileSync(BASELINE, JSON.stringify({ ...old, ...current }, null, 2) + '\n');
        return;
    }
    const baseline: Record<string, Record<string, number>> = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    const drops: string[] = [];
    const gains: string[] = [];
    for (const [page, scores] of Object.entries(current)) {
        for (const [k, v] of Object.entries(scores)) {
            const was = baseline[page]?.[k];
            if (was === undefined) continue;
            if (v < was) drops.push(`${page} ${k}: ${was}% → ${v}%`);
            if (v > was) gains.push(`${page} ${k}: ${was}% → ${v}%`);
        }
    }
    if (gains.length) console.log(`Better than the baseline (raise it with UPDATE_BASELINE=1):\n  ${gains.join('\n  ')}`);
    expect(drops, 'scores below the baseline').toEqual([]);
});
