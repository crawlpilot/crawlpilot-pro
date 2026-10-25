/** Turns a JSON array of objects into table rows: nested objects flattened with dotted keys. */

const MAX_DEPTH = 3;
const MAX_COLUMNS = 80;

function flatten(value: unknown, prefix: string, out: Record<string, unknown>, depth: number) {
    if (value === null || value === undefined) {
        if (prefix) out[prefix] = '';
        return;
    }
    if (Array.isArray(value)) {
        if (value.every(v => v === null || typeof v !== 'object')) {
            out[prefix] = value.join(', ');
        } else {
            out[prefix] = JSON.stringify(value);
        }
        return;
    }
    if (typeof value === 'object') {
        if (depth >= MAX_DEPTH) {
            out[prefix] = JSON.stringify(value);
            return;
        }
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
        }
        return;
    }
    out[prefix || 'value'] = value;
}

export interface JsonTable {
    columns: string[];
    rows: Record<string, unknown>[];
}

export function tableFromArray(items: unknown[]): JsonTable {
    const rows = items.map(item => {
        const row: Record<string, unknown> = {};
        flatten(item, '', row, 0);
        return row;
    });
    // Columns in first-seen order, keeping the ones most rows fill when there are too many.
    const counts = new Map<string, number>();
    rows.forEach(r => Object.keys(r).forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1)));
    let columns = Array.from(counts.keys());
    if (columns.length > MAX_COLUMNS) {
        const keep = new Set([...columns].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, MAX_COLUMNS));
        columns = columns.filter(c => keep.has(c));
    }
    return { columns, rows };
}
