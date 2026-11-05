/**
 * A field's cleanup steps: the public text ops (`shared/transforms/chain.ts`) plus Pro's own: `splitList`
 * turns text into a list, `toObject` turns "Name: value" lines (or list items) into an object, `join` turns
 * a list back into text, and `lua` runs a short Lua script on the text (`lua.ts`). Text ops after
 * `splitList` run on each item.
 */
import { applyOps, OP_LABELS, type TransformOp } from '../../shared/transforms/chain';
import { runLua } from './lua';

export type ProOp =
    | TransformOp
    | { op: 'splitList'; sep: string }
    | { op: 'toObject'; sep: string }
    | { op: 'join'; sep: string }
    | { op: 'lua'; code: string };

export const PRO_OP_LABELS: Record<ProOp['op'], string> = {
    ...OP_LABELS,
    splitList: 'Text to list',
    toObject: '"Name: value" to object',
    join: 'List to text',
    lua: 'Lua script',
};

/** A new step of each kind, with its default settings. */
export const NEW_OP: Record<ProOp['op'], ProOp> = {
    trim: { op: 'trim' },
    collapse: { op: 'collapse' },
    lower: { op: 'lower' },
    upper: { op: 'upper' },
    regex: { op: 'regex', pattern: '(\\d[\\d.,]*)' },
    replace: { op: 'replace', find: '', with: '' },
    split: { op: 'split', sep: ',', index: 0 },
    prefix: { op: 'prefix', text: '' },
    suffix: { op: 'suffix', text: '' },
    stripHtml: { op: 'stripHtml' },
    absoluteUrl: { op: 'absoluteUrl' },
    splitList: { op: 'splitList', sep: '\\n' },
    toObject: { op: 'toObject', sep: ':' },
    join: { op: 'join', sep: ', ' },
    lua: { op: 'lua', code: 'return str' },
};

/** A separator as typed: `\n` and `\t` written out mean a new line and a tab. */
const sepOf = (sep: string) => sep.replace(/\\n/g, '\n').replace(/\\t/g, '\t') || '\n';

function toObject(lines: string[], sep: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of lines) {
        const at = line.indexOf(sep);
        if (at <= 0) continue;
        const name = line.slice(0, at).trim();
        if (name) out[name] = line.slice(at + sep.length).trim();
    }
    return out;
}

/** Runs the steps on a raw value. A list's text steps run on each item; an object is left as it is. */
export function applyProOps(raw: unknown, ops: ProOp[], base?: string): unknown {
    let v: unknown = raw;
    for (const o of ops) {
        if (o.op === 'splitList') {
            const sep = sepOf(o.sep);
            const items = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
            v = items.flatMap(s => s.split(sep)).map(s => s.trim()).filter(Boolean);
        } else if (o.op === 'toObject') {
            const lines = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split('\n') : [];
            if (lines.length) v = toObject(lines, sepOf(o.sep));
        } else if (o.op === 'join') {
            if (Array.isArray(v)) v = v.map(item => item ?? '').join(o.sep);
        } else if (o.op === 'lua') {
            v = Array.isArray(v) ? v.map(item => runLua(o.code, String(item))) : typeof v === 'string' ? runLua(o.code, v) : v;
        } else if (Array.isArray(v)) {
            v = v.map(item => applyOps(String(item), [o], base));
        } else if (typeof v === 'string') {
            v = applyOps(v, [o], base);
        }
    }
    return v;
}

/** A step in a few words, for its chip ("Split & pick , #0"). */
export function opSummary(o: ProOp): string {
    const label = PRO_OP_LABELS[o.op];
    switch (o.op) {
        case 'regex': return `${label} ${o.pattern}`;
        case 'replace': return `${label} "${o.find}" → "${o.with}"`;
        case 'split': return `${label} "${o.sep}" #${o.index}`;
        case 'prefix': case 'suffix': return `${label} "${o.text}"`;
        case 'splitList': case 'toObject': return `${label} (${o.sep})`;
        case 'join': return `${label} "${o.sep}"`;
        case 'lua': return `${label} ${o.code.length > 40 ? `${o.code.slice(0, 40)}…` : o.code}`;
        default: return label;
    }
}
