import { useState } from 'react';
import { Button, IconButton, Menu, MenuItem, Notice, Progress, Text, Tooltip } from '../../ui';
import { Combine, Split, X } from 'lucide-react';
import { dropField, fieldFill, fieldShapes, FieldData, joinFields, renameField, retypeField, splitField } from '../../../shared/extraction/fieldEdits';

interface PageData {
    label: string;
    matched: number;
    sampled: number;
    columns: FieldData['columns'];
    items: FieldData['items'];
}

interface Props {
    data: FieldData & {
        metadata?: { fieldProblems?: string[] };
        /** The same rows in the page's own JSON, when found. */
        structured?: PageData;
        /** The layout-based fields, kept while the page's data is used. */
        layoutFields?: { columns: FieldData['columns']; items: FieldData['items'] };
    };
    onChange: (data: FieldData) => void;
}

const LOW_FILL = 0.5;
const HIDDEN = new Set(['recordId']);
const TYPES = ['text', 'number', 'price', 'date', 'url', 'image', 'image_array', 'link_array'];

function sample(data: FieldData, id: string): string {
    const v = data.items.find(i => i[id] !== undefined && i[id] !== null && i[id] !== '')?.[id];
    return v === undefined ? '' : String(v);
}

/**
 * The list's fields as they will be extracted: one column each. Rename, drop or join fields here,
 * before the run, instead of merging columns in the data table afterwards.
 */
export function FieldEditor({ data, onChange }: Props) {
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [joinMenu, setJoinMenu] = useState<{ anchor: HTMLElement; id: string } | null>(null);
    const [typeMenu, setTypeMenu] = useState<{ anchor: HTMLElement; id: string } | null>(null);

    const columns = (data.columns || []).filter(c => !HIDDEN.has(c.id));
    if (columns.length === 0) return null;
    const rows = data.items?.length ?? 0;
    // Field-level checks are recomputed live below; only whole-list problems come from the picker.
    const listProblems = (data.metadata?.fieldProblems || []).filter(p => !p.startsWith('“'));

    const commitRename = (id: string) => {
        onChange(renameField(data, id, draft));
        setEditing(null);
    };

    const typeOf = columns.find(c => c.id === typeMenu?.id)?.type;

    return (
        <div>
            <Text size="caption" weight="semibold" tone="muted" className="mb-1">
                Fields ({columns.length}) · from {rows} row{rows !== 1 ? 's' : ''}
            </Text>
            <div className="flex flex-col gap-1.5">
                {data.structured && !data.layoutFields && (
                    <Notice tone="info" action={<Button size="sm" onClick={() => onChange({
                        ...data, columns: data.structured!.columns, items: data.structured!.items,
                        layoutFields: { columns: data.columns, items: data.items },
                    })}>Use it</Button>}>
                        The page's own data ({data.structured.label}) has these rows with {data.structured.columns.length} named fields.
                    </Notice>
                )}
                {data.layoutFields && (
                    <Notice tone="success" action={<Button size="sm" onClick={() => onChange({
                        ...data, columns: data.layoutFields!.columns, items: data.layoutFields!.items, layoutFields: undefined,
                    })}>Use layout</Button>}>
                        Reading from the page's data ({data.structured?.label ?? 'JSON'}), matched to each row on the page.
                    </Notice>
                )}
                {listProblems.map(p => <Notice key={p} tone="warning">{p}</Notice>)}
            </div>
            <div className="mt-1.5 overflow-hidden rounded-field border border-line">
                {columns.map((col, i) => {
                    const fill = fieldFill(data, col.id);
                    const low = rows >= 4 && fill < LOW_FILL;
                    const shapes = fieldShapes(data, col.id);
                    return (
                        <div key={col.id} className={`flex items-center gap-1.5 py-1.5 pr-1 pl-3 ${i ? 'border-t border-line' : ''}`}>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    {editing === col.id ? (
                                        <input autoFocus value={draft} aria-label="Field name"
                                            onChange={e => setDraft(e.target.value)}
                                            onBlur={() => commitRename(col.id)}
                                            onKeyDown={e => { if (e.key === 'Enter') commitRename(col.id); if (e.key === 'Escape') setEditing(null); }}
                                            className="min-w-0 flex-1 rounded-md border-[1.5px] border-line-strong bg-surface px-1.5 py-0.5 text-small font-semibold text-ink outline-none" />
                                    ) : (
                                        <Tooltip title="Click to rename">
                                            <button type="button" onClick={() => { setEditing(col.id); setDraft(col.name); }}
                                                className="min-w-0 cursor-text truncate rounded px-0.5 text-left text-small font-semibold text-ink hover:bg-ink/6">
                                                {col.name}
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="Change type">
                                        <button type="button" onClick={e => setTypeMenu({ anchor: e.currentTarget, id: col.id })}
                                            className="shrink-0 cursor-pointer rounded-full bg-ink/7 px-1.5 py-px font-mono text-[10px] text-ink-2 hover:bg-ink/12">
                                            {col.type}
                                        </button>
                                    </Tooltip>
                                </div>
                                <Text size="caption" tone="faint" truncate className="px-0.5">{sample(data, col.id).slice(0, 120) || '—'}</Text>
                            </div>
                            <Tooltip title={low
                                ? `Empty in ${Math.round((1 - fill) * rows)} of ${rows} rows: drop it, or join it into the field it is a variant of`
                                : `Filled in ${Math.round(fill * 100)}% of rows`}>
                                <div className="w-11 shrink-0"><Progress size="sm" value={fill * 100} tone={low ? 'danger' : 'success'} /></div>
                            </Tooltip>
                            {shapes.length > 1 && (
                                <IconButton size="sm" label={`Split by kind of value (${shapes.join(', ')})`} onClick={() => onChange(splitField(data, col.id))}><Split /></IconButton>
                            )}
                            <IconButton size="sm" label="Join into another field (same thing in a different card layout)" disabled={columns.length < 2}
                                onClick={e => setJoinMenu({ anchor: e.currentTarget, id: col.id })}><Combine /></IconButton>
                            <IconButton size="sm" label="Drop this field" onClick={() => onChange(dropField(data, col.id))}><X /></IconButton>
                        </div>
                    );
                })}
            </div>
            <Menu anchor={typeMenu?.anchor ?? null} onClose={() => setTypeMenu(null)}>
                {TYPES.map(type => (
                    <MenuItem key={type} selected={typeOf === type}
                        onClick={() => { if (typeMenu) onChange(retypeField(data, typeMenu.id, type)); setTypeMenu(null); }}>
                        {type}
                    </MenuItem>
                ))}
            </Menu>
            <Menu anchor={joinMenu?.anchor ?? null} onClose={() => setJoinMenu(null)}>
                <div className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-ink-3">Join into…</div>
                {columns.filter(c => c.id !== joinMenu?.id).map(c => (
                    <MenuItem key={c.id} onClick={() => { if (joinMenu) onChange(joinFields(data, c.id, joinMenu.id)); setJoinMenu(null); }}>
                        {c.name}
                    </MenuItem>
                ))}
            </Menu>
        </div>
    );
}
