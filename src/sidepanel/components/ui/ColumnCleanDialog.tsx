import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Chip, Dialog, IconButton, Menu, MenuItem, Stack, Switch, Text, TextField, ToggleChip } from '../../ui';
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
    const field = (label: string, value: string, set: (v: string) => void, width = 'w-28') => (
        <TextField size="sm" label={label} value={value} onChange={e => set(e.target.value)} className={width} inputClassName="font-mono" />
    );
    switch (op.op) {
        case 'regex':
            return field('Pattern', op.pattern, v => onChange({ ...op, pattern: v }), 'w-44');
        case 'replace':
            return (
                <div className="flex flex-wrap items-end gap-2">
                    {field('Find', op.find, v => onChange({ ...op, find: v }))}
                    {field('With', op.with, v => onChange({ ...op, with: v }))}
                    <Switch checked={!!op.regex} onChange={v => onChange({ ...op, regex: v })} label="Regex" className="pb-1.5" />
                </div>
            );
        case 'split':
            return (
                <div className="flex gap-2">
                    {field('Separator', op.sep, v => onChange({ ...op, sep: v }), 'w-24')}
                    {field('Part (0, 1, -1…)', String(op.index), v => onChange({ ...op, index: parseInt(v, 10) || 0 }), 'w-32')}
                </div>
            );
        case 'prefix':
        case 'suffix':
            return field('Text', op.text, v => onChange({ ...op, text: v }), 'w-44');
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
        <Dialog open={open} onClose={onClose} size="lg" title={`Clean “${sourceName}”`}
            actions={<>
                {existing && onRemove && <Button variant="ghost" className="mr-auto text-danger" onClick={() => onRemove(existing.id)}>Remove column</Button>}
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={apply}>{existing ? 'Update' : 'Add typed column'}</Button>
            </>}>
            <Stack gap={5}>
                <div>
                    <Text size="small" tone="muted">
                        Detected: <b className="text-ink">{detected.label}</b>{detected.type !== 'text' ? ` · ${Math.round(detected.coverage * 100)}% of values` : ''}
                    </Text>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map(t => (
                            <ToggleChip key={t} selected={t === type} onClick={() => setType(t)}>{FIELD_TYPE_LABELS[t]}</ToggleChip>
                        ))}
                    </div>
                    {type === 'date' && <Switch className="mt-3" checked={dayFirst} onChange={setDayFirst} label="Dates are day-first (25/12/2024)" />}
                </div>

                <div>
                    <Text size="small" tone="muted">Steps before parsing (applied in order)</Text>
                    <Stack gap={2} className="mt-2">
                        {ops.map((o, i) => (
                            <div key={i} className="flex flex-wrap items-end gap-2 rounded-field bg-surface-2 p-2">
                                <Chip size="md" className="mb-1.5">{`${i + 1}. ${OP_LABELS[o.op]}`}</Chip>
                                <OpParams op={o} onChange={n => setOps(ops.map((x, j) => (j === i ? n : x)))} />
                                <IconButton size="sm" label="Remove step" className="mb-1 ml-auto" onClick={() => setOps(ops.filter((_, j) => j !== i))}><X /></IconButton>
                            </div>
                        ))}
                        <div>
                            <Button size="sm" icon={<Plus />} onClick={e => setMenuAnchor(e.currentTarget)}>Add step</Button>
                            <Menu anchor={menuAnchor} onClose={() => setMenuAnchor(null)}>
                                {(Object.keys(NEW_OP) as TransformOp['op'][]).map(k => (
                                    <MenuItem key={k} onClick={() => { setOps([...ops, { ...NEW_OP[k] } as TransformOp]); setMenuAnchor(null); }}>{OP_LABELS[k]}</MenuItem>
                                ))}
                            </Menu>
                        </div>
                    </Stack>
                </div>

                <TextField label="New column name" placeholder={defaultName} value={name} onChange={e => setName(e.target.value)} />

                <div>
                    <Text size="small" weight="semibold" tone={failed ? 'warning' : 'success'}>
                        {results.length - failed} of {results.length} values parsed{failed ? ` · ${failed} left empty` : ''}
                    </Text>
                    <div className="mt-2 max-h-64 overflow-auto rounded-field border border-line">
                        <table className="w-full border-collapse text-caption [&_td]:border-b [&_td]:border-line [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink-2">
                            <thead>
                                <tr><th>Raw</th>{ops.length > 0 && <th>After steps</th>}<th>Result</th></tr>
                            </thead>
                            <tbody>
                                {results.slice(0, 12).map((r, i) => (
                                    <tr key={i} className="text-ink">
                                        <td className="max-w-[260px] break-words">{show(r.raw)}</td>
                                        {ops.length > 0 && <td className="font-mono">{r.steps.length ? r.steps[r.steps.length - 1].value : ''}</td>}
                                        <td className={r.ok ? 'font-mono' : 'font-mono text-danger'}>
                                            {r.ok ? `${show(r.value)}${r.currency ? ` ${r.currency}` : ''}` : 'could not parse'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </Stack>
        </Dialog>
    );
}
