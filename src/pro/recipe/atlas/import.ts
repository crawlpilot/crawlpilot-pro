/**
 * An Atlas template export (`responseObj`: attributes, error pages, elements, as the template API serves
 * them) as a Pro page recipe (`docs/design/LLD.md` §6.3). Each attribute is a field, each of its templates a
 * way, in Atlas's order:
 * - `CSS_SLCTR` reads the match's text (as Jsoup does), `CSS_SLCTR_ATTR` its `keyElement` attribute,
 *   `CSS_SLCTR_CNT` how many there are;
 * - `A` takes the first match, `AFL` the first that cleans to something, `AL` all of them joined with " > ",
 *   `ALO` all of them as a list, `TD` name/value rows as an object, `M` an object too;
 * - `specialFormatting` is a regex (group 0, trimmed), a `luaj:` script, or `.*` (nothing to do);
 * - asserts and their expression are the way's condition.
 * Error pages become page rules (404: not found; anonymity and login pages, captchas: blocked; the rest:
 * an error). The `URL_SKU` element, a regex on the URL, becomes the identity check against `SKU`.
 * Anything with no equivalent is left out and said so: every note goes into the version's note.
 */
import type { Condition, CountOp, PageRule, RuleStatus } from '../../../shared/types/ways';
import type { ImportedRecipe } from '../file';
import type { ProOp } from '../ops';
import type { Field, FieldType, Identity, PageRecipeSpec, Way } from '../types';
import { javaRegex } from './regex';

interface AtlasAssert {
    assrt?: string;
    assrtValue?: string;
    assrtFnct?: string;
    assrtId?: string | number;
    type?: string;
}

interface AtlasTemplate {
    extractMethod?: string;
    extractMethodType?: string;
    keyElement?: string | null;
    specialFormatting?: string | null;
    uniqueTemplateId?: string;
    assrtXprn?: string | null;
    asserts?: AtlasAssert[];
    primaryExtractMethod?: string;
    secondaryExtractMethod?: string;
}

interface AtlasAttribute {
    name: string;
    type: string;
    templates?: AtlasTemplate[];
}

interface AtlasExport {
    competitorShortName?: string;
    attributes?: AtlasAttribute[];
    errorPages?: AtlasAttribute[];
    elements?: AtlasAttribute[];
}

/** Atlas competitors' sites, for the recipe's site; others are the short name in lower case. */
const SITES: Record<string, string> = { AMZ: 'amazon.com', WMART: 'walmart.com' };

const ERROR_STATUS: Record<string, RuleStatus> = {
    '404': 'not_found', '410': 'not_found', ANONYMITY_ERROR_PAGE: 'blocked', '405': 'blocked', '403': 'blocked',
};

const FIELD: Record<string, { type: FieldType; pick?: Way['pick']; join?: boolean }> = {
    A: { type: 'text' },
    AFL: { type: 'text', pick: 'firstFilled' },
    AL: { type: 'text', pick: 'all', join: true },
    ALO: { type: 'list', pick: 'all' },
    TD: { type: 'object' },
    M: { type: 'object' },
};

const COUNT_OP: Record<string, CountOp> = { EQUAL_TO: 'eq', GREATER_THAN: 'gt', LESS_THAN: 'lt' };

/** Jsoup selector features a browser doesn't have; `:contains` is read in the page (`content/services/page/ways.ts`). */
const JSOUP_ONLY = /:(containsOwn|containsData|matches|matchesOwn|eq|lt|gt)\(/i;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The export as the template API returns it, or the fragment Atlas's UI copies (`"responseObj": {…}`, maybe without its last brace). */
function parse(raw: string): AtlasExport | null {
    for (const text of [raw, `{${raw}}`, `{${raw}}}`]) {
        let json: unknown;
        try { json = JSON.parse(text); } catch { continue; }
        const obj = isObject(json) && isObject(json.responseObj) ? json.responseObj : json;
        if (isObject(obj) && Array.isArray(obj.attributes)) return obj as AtlasExport;
    }
    return null;
}

export const isAtlasExport = (raw: string) => /"responseObj"\s*:|"competitorTemplateId"\s*:/.test(raw) && parse(raw) !== null;

/**
 * A Jsoup selector as CSS: attribute values quoted as Jsoup reads them (an apostrophe inside single
 * quotes is part of the value) and compared without case, as Jsoup compares them.
 */
export function cssOf(selector: string): string {
    let out = '';
    for (let i = 0; i < selector.length; i++) {
        if (selector[i] !== '[') { out += selector[i]; continue; }
        // Jsoup's balance: quotes toggle, so an even number of apostrophes inside keeps the brackets matched.
        let j = i + 1, single = false, double = false;
        for (; j < selector.length; j++) {
            const c = selector[j];
            if (c === "'" && !double) single = !single;
            else if (c === '"' && !single) double = !double;
            else if (c === ']' && !single && !double) break;
        }
        const inner = selector.slice(i + 1, j);
        const m = /^\s*([^\s~|^$*!=]+)\s*([|^$*]?=)\s*([\s\S]*?)\s*$/.exec(inner);
        if (m) {
            let value = m[3];
            if (/^(['"])[\s\S]*\1$/.test(value)) value = value.slice(1, -1);
            out += `[${m[1]}${m[2]}"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" i]`;
        } else {
            out += `[${inner}]`;
        }
        i = j;
    }
    return out.trim();
}

type Notes = string[];

function assertCondition(a: AtlasAssert, where: string, notes: Notes): Condition {
    const never: Condition = { kind: 'any', of: [] };
    const op = COUNT_OP[(a.assrtFnct ?? '').toUpperCase()];
    const value = Number(a.assrtValue);
    if (!op) { notes.push(`${where}: assert function "${a.assrtFnct}" is unknown; it never holds.`); return never; }
    if (a.assrtValue === undefined || a.assrtValue.trim() === '' || !Number.isFinite(value)) {
        notes.push(`${where}: assert value "${a.assrtValue}" is not a count; it never holds.`);
        return never;
    }
    if (a.type === 'CSS_SLCTR_CNT') return { kind: 'css', selector: cssOf(a.assrt ?? ''), op, value };
    if (a.type === 'REGEX_CNT') {
        const re = javaRegex(a.assrt ?? '', '');
        if ('error' in re) { notes.push(`${where}: regex ${a.assrt} does not compile here (${re.error}); it never holds.`); return never; }
        return { kind: 'regex', pattern: re.pattern, ...(re.flags ? { flags: re.flags } : {}), op, value };
    }
    notes.push(`${where}: assert type ${a.type} is not supported; it never holds.`);
    return never;
}

/**
 * The template's asserts as one condition, or none (no asserts: always tried). Atlas evaluates the
 * expression as JavaScript, so AND binds tighter than OR; without an expression only the first assert counts.
 */
function conditionOf(t: AtlasTemplate, where: string, notes: Notes): Condition | undefined {
    const asserts = t.asserts ?? [];
    if (!asserts.length) return undefined;
    const byId = new Map(asserts.map(a => [String(a.assrtId), a]));
    const expr = t.assrtXprn?.trim();
    if (!expr) {
        const first = [...asserts].sort((a, b) => Number(a.assrtId) - Number(b.assrtId))[0];
        if (asserts.length > 1) notes.push(`${where}: ${asserts.length} asserts and no expression; only ASSERT${first.assrtId} counts, as in Atlas.`);
        return assertCondition(first, where, notes);
    }
    const tokens = expr.toUpperCase().match(/ASSERT\d+|AND|OR|&&|\|\||\(|\)|\S+/g) ?? [];
    let at = 0;
    const fail = (): Condition => { notes.push(`${where}: assert expression "${expr}" is not understood; it never holds.`); at = tokens.length; return { kind: 'any', of: [] }; };
    const primary = (): Condition => {
        const tok = tokens[at++];
        if (tok === '(') {
            const c = or();
            if (tokens[at++] !== ')') return fail();
            return c;
        }
        const id = /^ASSERT(\d+)$/.exec(tok ?? '')?.[1];
        if (!id) return fail();
        const a = byId.get(id);
        if (!a) { notes.push(`${where}: ASSERT${id} is not one of the template's asserts; it never holds.`); return { kind: 'any', of: [] }; }
        return assertCondition(a, where, notes);
    };
    const and = (): Condition => {
        const of = [primary()];
        while (tokens[at] === 'AND' || tokens[at] === '&&') { at++; of.push(primary()); }
        return of.length === 1 ? of[0] : { kind: 'all', of };
    };
    const or = (): Condition => {
        const of = [and()];
        while (tokens[at] === 'OR' || tokens[at] === '||') { at++; of.push(and()); }
        return of.length === 1 ? of[0] : { kind: 'any', of };
    };
    const c = or();
    return at < tokens.length ? fail() : c;
}

/** `specialFormatting` as a way's steps; null when it can't be done here. */
function opsOf(sf: string | null | undefined, where: string, notes: Notes): ProOp[] | null {
    const f = sf?.trim() ?? '';
    if (!f || f === '.*') return [];
    if (f.startsWith('luaj:')) return [{ op: 'lua', code: f.slice(5).trim() }];
    if (f.startsWith('json:')) { notes.push(`${where}: a JSON path (${f}) is not supported; this template is left out.`); return null; }
    const re = javaRegex(f, 'is');
    if ('error' in re) { notes.push(`${where}: regex ${f} does not compile here (${re.error}); this template is left out.`); return null; }
    return [{ op: 'regex', pattern: re.pattern, flags: re.flags, group: 0 }, { op: 'trim' }];
}

function wayOf(attr: AtlasAttribute, t: AtlasTemplate, index: number, notes: Notes): Way | null {
    const id = t.uniqueTemplateId || `${attr.name}-${index}`;
    const where = `${attr.name} / ${id}`;
    const selector = t.extractMethod?.trim() ?? '';
    if (!selector) { notes.push(`${where}: no selector; left out.`); return null; }
    if (JSOUP_ONLY.test(selector)) notes.push(`${where}: "${selector}" uses a Jsoup-only selector; it will match nothing.`);
    const method = t.extractMethodType ?? 'CSS_SLCTR';
    if (method !== 'CSS_SLCTR' && method !== 'CSS_SLCTR_ATTR' && method !== 'CSS_SLCTR_CNT') {
        notes.push(`${where}: method ${method} is not supported; left out.`);
        return null;
    }
    const ops = opsOf(t.specialFormatting, where, notes);
    if (!ops) return null;
    const kind = FIELD[attr.type];
    const when = conditionOf(t, where, notes);
    const attrName = method === 'CSS_SLCTR_ATTR' ? t.keyElement?.trim() : undefined;
    if (method === 'CSS_SLCTR_ATTR' && !attrName) { notes.push(`${where}: no attribute to read (keyElement); left out.`); return null; }

    const base = { id, kind: 'selector' as const, selector: cssOf(selector), ...(when ? { when } : {}) };
    if (attr.type === 'TD') {
        if (ops.length) notes.push(`${where}: its regex cleans the values only, not the names.`);
        return { ...base, read: 'pairs', pairs: { key: cssOf(t.primaryExtractMethod ?? ''), value: cssOf(t.secondaryExtractMethod ?? '') }, ...(ops.length ? { ops } : {}) };
    }
    if (attr.type === 'M') {
        // Each match's text names the value: its attribute (`CSS_SLCTR_ATTR`), or its own "name: value" text.
        if (attrName) return { ...base, read: 'pairs', attr: attrName, pairs: {}, ...(ops.length ? { ops } : {}) };
        return { ...base, read: 'text', pick: 'all', ops: [...ops, { op: 'toObject', sep: ':' }] };
    }
    const read = method === 'CSS_SLCTR_CNT' ? 'count' as const : attrName ? 'attr' as const : 'text' as const;
    const allOps: ProOp[] = kind.join ? [...ops, { op: 'join', sep: ' > ' }] : ops;
    return { ...base, read, ...(attrName ? { attr: attrName } : {}), ...(kind.pick ? { pick: kind.pick } : {}), ...(allOps.length ? { ops: allOps } : {}) };
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';

function fieldsOf(x: AtlasExport, notes: Notes): Field[] {
    const fields: Field[] = [];
    const ids = new Set<string>();
    for (const attr of x.attributes ?? []) {
        const kind = FIELD[attr.type];
        if (!kind) { notes.push(`${attr.name}: attribute type ${attr.type} is not supported; left out.`); continue; }
        const ways = (attr.templates ?? []).flatMap((t, i) => wayOf(attr, t, i, notes) ?? []);
        if (!ways.length) { notes.push(`${attr.name}: none of its templates could be imported; left out.`); continue; }
        let id = slug(attr.name);
        for (let n = 2; ids.has(id); n++) id = `${slug(attr.name)}_${n}`;
        ids.add(id);
        fields.push({ id, name: attr.name, type: kind.type, read: kind.type === 'list' ? 'text_array' : 'text', ways, ops: [] });
    }
    return fields;
}

function rulesOf(x: AtlasExport, notes: Notes): PageRule[] {
    const rules: PageRule[] = [];
    for (const page of x.errorPages ?? []) {
        const status = ERROR_STATUS[page.name] ?? 'error';
        for (const [i, t] of (page.templates ?? []).entries()) {
            const when = conditionOf(t, `error page ${page.name}`, notes);
            if (!when) { notes.push(`error page ${page.name}: template ${i + 1} has no asserts; left out (it would hold on every page).`); continue; }
            rules.push({ name: page.name, status, when });
        }
    }
    for (const el of x.elements ?? []) {
        if (!/^CAPTCHA/i.test(el.name)) continue;
        const of: Condition[] = (el.templates ?? []).flatMap(t => t.extractMethod?.trim() ? [{ kind: 'css' as const, selector: cssOf(t.extractMethod), op: 'gt' as const, value: 0 }] : []);
        if (of.length) rules.push({ name: el.name, status: 'blocked', when: of.length === 1 ? of[0] : { kind: 'any', of } });
    }
    return rules;
}

function identityOf(x: AtlasExport, fields: Field[], notes: Notes): Identity | undefined {
    const skipped: string[] = [];
    let identity: Identity | undefined;
    for (const el of x.elements ?? []) {
        if (/^CAPTCHA/i.test(el.name)) continue;
        const fromUrl = el.name === 'URL_SKU' ? (el.templates ?? []).filter(t => !t.extractMethod?.trim() && t.specialFormatting) : [];
        if (!fromUrl.length) { skipped.push(el.name); continue; }
        if (!fields.some(f => f.name === 'SKU')) { notes.push('URL_SKU: no SKU field to check it against; the identity check is left out.'); continue; }
        const url = fromUrl.flatMap(t => {
            const re = javaRegex(t.specialFormatting!, '');
            if ('error' in re || re.flags.replace(/[is]/g, '')) { notes.push(`URL_SKU: regex ${t.specialFormatting} can't be used here; left out.`); return []; }
            return [re.pattern];
        });
        if (url.length) identity = { field: 'SKU', url };
    }
    if (skipped.length) notes.push(`Elements ${skipped.join(', ')}: page actions and search results are not part of a page recipe; left out.`);
    return identity;
}

/** The export as an imported recipe (one version), and every note about what could not be carried over. */
export function readAtlasExport(raw: string): ImportedRecipe & { notes: string[] } {
    // Parsed again after `isAtlasExport`: imports are rare and the exports small.
    const x = parse(raw);
    if (!x) throw new Error('Not an Atlas template export');
    const notes: Notes = [];
    const short = x.competitorShortName?.trim() || 'ATLAS';
    const fields = fieldsOf(x, notes);
    const rules = rulesOf(x, notes);
    const identity = identityOf(x, fields, notes);
    const spec: PageRecipeSpec = {
        kind: 'page',
        steps: fields.map(field => ({ kind: 'field', field })),
        ...(rules.length ? { rules } : {}),
        ...(identity ? { identity } : {}),
    };
    const head = `Imported from Atlas (${short}): ${fields.length} fields, ${rules.length} page rules${identity ? ', identity check on SKU' : ''}.`;
    const shown = notes.slice(0, 40);
    const note = notes.length ? `${head}\n${shown.map(n => `- ${n}`).join('\n')}${notes.length > shown.length ? `\n- …and ${notes.length - shown.length} more` : ''}` : head;
    return {
        name: `${short} product (Atlas)`,
        site: SITES[short] ?? short.toLowerCase(),
        kind: 'page',
        targeting: { competitor: short.toLowerCase(), pageType: 'product' },
        versions: [{ spec, settings: {}, pages: { kind: 'urls', urls: [] }, output: {}, note }],
        samples: [],
        notes,
    };
}
