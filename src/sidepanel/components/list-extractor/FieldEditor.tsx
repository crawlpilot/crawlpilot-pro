import { useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
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

    return (
        <Box>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" textTransform="uppercase" sx={{ display: 'block', mb: 0.5 }}>
                Fields ({columns.length}) · from {rows} row{rows !== 1 ? 's' : ''}
            </Typography>
            {data.structured && !data.layoutFields && (
                <Alert severity="info" variant="outlined" sx={{ py: 0, mb: 0.75, fontSize: 11 }}
                    action={<Button size="small" sx={{ fontSize: 10 }} onClick={() => onChange({
                        ...data, columns: data.structured!.columns, items: data.structured!.items,
                        layoutFields: { columns: data.columns, items: data.items },
                    })}>Use it</Button>}>
                    The page's own data ({data.structured.label}) has these rows with {data.structured.columns.length} named fields.
                </Alert>
            )}
            {data.layoutFields && (
                <Alert severity="success" variant="outlined" sx={{ py: 0, mb: 0.75, fontSize: 11 }}
                    action={<Button size="small" sx={{ fontSize: 10 }} onClick={() => onChange({
                        ...data, columns: data.layoutFields!.columns, items: data.layoutFields!.items, layoutFields: undefined,
                    })}>Use layout</Button>}>
                    Reading from the page's data ({data.structured?.label ?? 'JSON'}), matched to each row on the page.
                </Alert>
            )}
            {listProblems.map(p => (
                <Alert key={p} severity="warning" variant="outlined" sx={{ py: 0, mb: 0.75, fontSize: 11 }}>{p}</Alert>
            ))}
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                {columns.map((col, i) => {
                    const fill = fieldFill(data, col.id);
                    const low = rows >= 4 && fill < LOW_FILL;
                    return (
                        <Box key={col.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    {editing === col.id ? (
                                        <TextField
                                            size="small" variant="standard" autoFocus value={draft}
                                            onChange={e => setDraft(e.target.value)}
                                            onBlur={() => commitRename(col.id)}
                                            onKeyDown={e => { if (e.key === 'Enter') commitRename(col.id); if (e.key === 'Escape') setEditing(null); }}
                                            inputProps={{ style: { fontSize: 12, padding: 0 } }}
                                        />
                                    ) : (
                                        <Tooltip title="Click to rename">
                                            <Typography
                                                variant="caption" fontWeight={600} noWrap sx={{ cursor: 'text' }}
                                                onClick={() => { setEditing(col.id); setDraft(col.name); }}
                                            >
                                                {col.name}
                                            </Typography>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="Change type">
                                        <Chip size="small" label={col.type} variant="outlined" sx={{ height: 16, fontSize: 9, cursor: 'pointer' }}
                                            onClick={e => setTypeMenu({ anchor: e.currentTarget, id: col.id })} />
                                    </Tooltip>
                                </Box>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: 10 }}>
                                    {sample(data, col.id).slice(0, 120) || '—'}
                                </Typography>
                            </Box>
                            <Tooltip title={low
                                ? `Empty in ${Math.round((1 - fill) * rows)} of ${rows} rows: drop it, or join it into the field it is a variant of`
                                : `Filled in ${Math.round(fill * 100)}% of rows`}>
                                <Box sx={{ width: 44 }}>
                                    <LinearProgress variant="determinate" value={fill * 100} color={low ? 'warning' : 'success'} sx={{ height: 4, borderRadius: 2 }} />
                                </Box>
                            </Tooltip>
                            {fieldShapes(data, col.id).length > 1 && (
                                <Tooltip title={`Split by kind of value (${fieldShapes(data, col.id).join(', ')})`}>
                                    <IconButton size="small" onClick={() => onChange(splitField(data, col.id))}>
                                        <Split size={13} />
                                    </IconButton>
                                </Tooltip>
                            )}
                            <Tooltip title="Join into another field (same thing in a different card layout)">
                                <span>
                                    <IconButton size="small" disabled={columns.length < 2} onClick={e => setJoinMenu({ anchor: e.currentTarget, id: col.id })}>
                                        <Combine size={13} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Drop this field">
                                <IconButton size="small" onClick={() => onChange(dropField(data, col.id))}>
                                    <X size={13} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );
                })}
            </Box>
            <Menu anchorEl={typeMenu?.anchor} open={!!typeMenu} onClose={() => setTypeMenu(null)}>
                {TYPES.map(type => (
                    <MenuItem key={type} sx={{ fontSize: 12 }}
                        selected={columns.find(c => c.id === typeMenu?.id)?.type === type}
                        onClick={() => { if (typeMenu) onChange(retypeField(data, typeMenu.id, type)); setTypeMenu(null); }}>
                        {type}
                    </MenuItem>
                ))}
            </Menu>
            <Menu anchorEl={joinMenu?.anchor} open={!!joinMenu} onClose={() => setJoinMenu(null)}>
                <MenuItem disabled sx={{ fontSize: 11 }}>Join into…</MenuItem>
                {columns.filter(c => c.id !== joinMenu?.id).map(c => (
                    <MenuItem
                        key={c.id} sx={{ fontSize: 12 }}
                        onClick={() => { if (joinMenu) onChange(joinFields(data, c.id, joinMenu.id)); setJoinMenu(null); }}
                    >
                        {c.name}
                    </MenuItem>
                ))}
            </Menu>
        </Box>
    );
}
