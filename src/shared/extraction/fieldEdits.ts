/**
 * Edits to a list's fields before the run: rename, drop, join two fields into one, change type.
 * They change the field schema (the columns' readers), not the data after the fact, so the run
 * itself reads one column per field and nothing has to be merged in the data table. The preview
 * rows are updated the same way so what the user sees matches what the run will produce.
 */

export interface EditableColumn {
    id: string;
    name: string;
    type: string;
    reader?: { alternates?: unknown[]; [k: string]: unknown };
    [k: string]: unknown;
}

export interface FieldData {
    columns: EditableColumn[];
    items: Record<string, unknown>[];
    [k: string]: unknown;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '';

export function renameField<T extends FieldData>(data: T, id: string, name: string): T {
    const clean = name.trim();
    if (!clean) return data;
    return { ...data, columns: data.columns.map(c => (c.id === id ? { ...c, name: clean } : c)) };
}

export function retypeField<T extends FieldData>(data: T, id: string, type: string): T {
    return { ...data, columns: data.columns.map(c => (c.id === id ? { ...c, type } : c)) };
}

export function dropField<T extends FieldData>(data: T, id: string): T {
    return {
        ...data,
        columns: data.columns.filter(c => c.id !== id),
        items: data.items.map(item => {
            if (!(id in item)) return item;
            const { [id]: _drop, ...rest } = item;
            return rest;
        }),
    };
}

/**
 * Joins `fromId` into `intoId`: one column whose reader falls back to the other field's reader, for
 * fields that are the same thing in different card variants. Preview rows keep `into`'s value and
 * take `from`'s where `into` is empty.
 */
export function joinFields<T extends FieldData>(data: T, intoId: string, fromId: string): T {
    const into = data.columns.find(c => c.id === intoId);
    const from = data.columns.find(c => c.id === fromId);
    if (!into || !from || intoId === fromId) return data;

    let reader = into.reader;
    if (into.reader && from.reader) {
        const { alternates: fromAlts = [], ...fromMain } = from.reader;
        reader = { ...into.reader, alternates: [...(into.reader.alternates ?? []), fromMain, ...fromAlts] };
    }
    const columns = data.columns.filter(c => c.id !== fromId).map(c => (c.id === intoId ? { ...c, reader } : c));
    const items = data.items.map(item => {
        const { [fromId]: fromValue, ...rest } = item;
        return filled(rest[intoId]) || !filled(fromValue) ? rest : { ...rest, [intoId]: fromValue };
    });
    return { ...data, columns, items };
}

/** Share of preview rows where the field has a value (0–1). */
export function fieldFill(data: FieldData, id: string): number {
    if (data.items.length === 0) return 0;
    return data.items.filter(i => filled(i[id])).length / data.items.length;
}
