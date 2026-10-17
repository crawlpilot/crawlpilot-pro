import { useEffect, useMemo, useState } from 'react';
import {
    Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu, MenuItem,
    Stack, Switch, TextField, Typography,
} from '@mui/material';
import { Plus, X, Wand2 } from 'lucide-react';
import type { TypedColumnDef } from '../../../shared/types/database';
import { applyChain, FIELD_TYPE_LABELS, FieldType, OP_LABELS, TransformOp } from '../../../shared/transforms/chain';
import { detectType } from '../../../shared/transforms/detect';

interface Props {
    open: boolean;
    sourceId: string;
    sourceName: string;
    /** Raw values of the source column (a sample is enough). */
    values: unknown[];
    baseUrl?: string;
    existing?: TypedColumnDef;
    onApply: (def: TypedColumnDef) => void;
    onRemove?: (id: string) => void;
    onClose: () => void;
}

const NEW_OP: Record<TransformOp['op'], TransformOp> = {
    trim: { op: 'trim' },
    collapse: { op: 'collapse' },
    lower: { op: 'lower' },
    upper: { op: 'upper' },
    regex: { op: 'regex', pattern: '(\\d[\\d.,]*)' },
    replace: { op: 'replace', find: '', with: '' },
    split: { op: 'split', sep: ',', index: 0 },
    prefix: { op: 'prefix', text: '' },
    suffix: { op: 'suffix', text: '' },
};

function show(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
}

function OpParams({ op, onChange }: { op: TransformOp; onChange: (o: TransformOp) => void }) {
    const field = (label: string, value: string, set: (v: string) => void, width = 110) => (
        <TextField size="small" label={label} value={value} onChange={e => set(e.target.value)}
            sx={{ width }} inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }} />
    );
    switch (op.op) {
        case 'regex':
            return <Stack direction="row" spacing={1}>{field('Pattern', op.pattern, v => onChange({ ...op, pattern: v }), 180)}</Stack>;
        case 'replace':
            return (
                <Stack direction="row" spacing={1} alignItems="center">
                    {field('Find', op.find, v => onChange({ ...op, find: v }))}
                    {field('With', op.with, v => onChange({ ...op, with: v }))}
                    <FormControlLabel control={<Switch size="small" checked={!!op.regex} onChange={e => onChange({ ...op, regex: e.target.checked })} />} label={<Typography variant="caption">Regex</Typography>} />
                </Stack>
            );
        case 'split':
            return (
                <Stack direction="row" spacing={1}>
                    {field('Separator', op.sep, v => onChange({ ...op, sep: v }), 90)}
                    {field('Part (0, 1, -1…)', String(op.index), v => onChange({ ...op, index: parseInt(v, 10) || 0 }), 120)}
                </Stack>
            );
        case 'prefix':
        case 'suffix':
            return <Stack direction="row">{field('Text', op.text, v => onChange({ ...op, text: v }), 180)}</Stack>;
        default:
            return null;
    }
}

export default function ColumnCleanDialog({ open, sourceId, sourceName, values, baseUrl, existing, onApply, onRemove, onClose }: Props) {
    const detected = useMemo(() => detectType(values, sourceName), [values, sourceName]);
    const [type, setType] = useState<FieldType>(existing?.type ?? detected.type);
    const [ops, setOps] = useState<TransformOp[]>(existing?.ops ?? []);
    const [dayFirst, setDayFirst] = useState(!!existing?.dayFirst);
    const [name, setName] = useState(existing?.name ?? '');
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setType(existing?.type ?? detected.type);
        setOps(existing?.ops ?? []);
        setDayFirst(!!existing?.dayFirst);
        setName(existing?.name ?? '');
    }, [open, existing, detected.type]);

    const defaultName = `${sourceName} (${FIELD_TYPE_LABELS[type].toLowerCase()})`;
    const sample = useMemo(() => values.filter(v => v !== null && v !== undefined && v !== '').slice(0, 200), [values]);
    const results = useMemo(() => sample.map(v => ({ raw: v, ...applyChain(v, type, ops, { baseUrl, dayFirst }) })), [sample, type, ops, baseUrl, dayFirst]);
    const failed = results.filter(r => !r.ok).length;

    const apply = () => {
        onApply({
            id: existing?.id ?? `typed_${sourceId}_${Date.now()}`,
            name: name.trim() || defaultName,
            source: sourceId,
            type,
            ops,
            dayFirst: type === 'date' ? dayFirst : undefined,
        });
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Wand2 size={18} /> Clean “{sourceName}”
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            Detected: <b>{detected.label}</b>{detected.type !== 'text' ? ` · ${Math.round(detected.coverage * 100)}% of values` : ''}
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                            {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map(t => (
                                <Chip key={t} size="small" label={FIELD_TYPE_LABELS[t]} onClick={() => setType(t)}
                                    color={t === type ? 'primary' : 'default'} variant={t === type ? 'filled' : 'outlined'} />
                            ))}
                        </Stack>
                        {type === 'date' && (
                            <FormControlLabel sx={{ mt: 0.5 }} control={<Switch size="small" checked={dayFirst} onChange={e => setDayFirst(e.target.checked)} />}
                                label={<Typography variant="caption">Dates are day-first (25/12/2024)</Typography>} />
                        )}
                    </Box>

                    <Box>
                        <Typography variant="caption" color="text.secondary">Steps before parsing (applied in order)</Typography>
                        <Stack spacing={1} sx={{ mt: 0.75 }}>
                            {ops.map((o, i) => (
                                <Stack key={i} direction="row" spacing={1} alignItems="center">
                                    <Chip size="small" label={`${i + 1}. ${OP_LABELS[o.op]}`} />
                                    <OpParams op={o} onChange={n => setOps(ops.map((x, j) => (j === i ? n : x)))} />
                                    <IconButton size="small" onClick={() => setOps(ops.filter((_, j) => j !== i))}><X size={14} /></IconButton>
                                </Stack>
                            ))}
                            <Box>
                                <Button size="small" startIcon={<Plus size={14} />} onClick={e => setMenuAnchor(e.currentTarget)}>Add step</Button>
                                <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
                                    {(Object.keys(NEW_OP) as TransformOp['op'][]).map(k => (
                                        <MenuItem key={k} dense onClick={() => { setOps([...ops, { ...NEW_OP[k] } as TransformOp]); setMenuAnchor(null); }}>{OP_LABELS[k]}</MenuItem>
                                    ))}
                                </Menu>
                            </Box>
                        </Stack>
                    </Box>

                    <TextField size="small" label="New column name" placeholder={defaultName} value={name} onChange={e => setName(e.target.value)} />

                    <Box>
                        <Typography variant="caption" color={failed ? 'warning.main' : 'success.main'}>
                            {results.length - failed} of {results.length} values parsed{failed ? ` · ${failed} left empty` : ''}
                        </Typography>
                        <Box sx={{ mt: 0.75, maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', textAlign: 'left', verticalAlign: 'top' } }}>
                                <thead>
                                    <tr><th>Raw</th>{ops.length > 0 && <th>After steps</th>}<th>Result</th></tr>
                                </thead>
                                <tbody>
                                    {results.slice(0, 12).map((r, i) => (
                                        <tr key={i}>
                                            <td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{show(r.raw)}</td>
                                            {ops.length > 0 && <td style={{ fontFamily: 'monospace' }}>{r.steps.length ? r.steps[r.steps.length - 1].value : ''}</td>}
                                            <td style={{ fontFamily: 'monospace', color: r.ok ? undefined : '#ef4444' }}>
                                                {r.ok ? `${show(r.value)}${r.currency ? ` ${r.currency}` : ''}` : 'could not parse'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Box>
                        </Box>
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions>
                {existing && onRemove && <Button color="error" onClick={() => onRemove(existing.id)} sx={{ mr: 'auto' }}>Remove column</Button>}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={apply}>{existing ? 'Update' : 'Add typed column'}</Button>
            </DialogActions>
        </Dialog>
    );
}
