/**
 * The recipe's transform (`PageRecipeSpec.transform`): what turns the page's record (its fields by name) into the
 * schema consumers want. Built as a mapping (`recipe/mapping.ts`), one row per output: where it goes, what it reads
 * (a field, a key of an object field, a column of a table field, or fixed text) and how (as is, as a number, joined…),
 * with its value on the page last tested. The rows can be proposed from the recipe's contract. The rows compile to the
 * JOLT chain the crawler runs, shown on the JOLT tab; a chain edited there by hand is kept as JOLT, without rows.
 */
import { useEffect, useState } from 'react';
import { Plus, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { Button, IconButton, Notice, Segmented, Select, Text, TextArea, TextField } from '../../sidepanel/ui';
import type { Contract } from '../../shared/contracts/contract';
import { joltProblems, joltTransform, type JoltOperation } from '../recipe/jolt';
import {
    compileMapping, fromKey, HOW_LABEL, mappingOutput, mappingSources, proposeMapping, valueAt,
    type MappingFrom, type MappingHow, type MappingRow,
} from '../recipe/mapping';
import type { PageRecipeSpec } from '../recipe/types';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const short = (v: unknown) => {
    if (v === undefined) return '—';
    const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
    return s.length > 90 ? `${s.slice(0, 90)}…` : s;
};

const HOWS = (Object.keys(HOW_LABEL) as MappingHow[]).map(value => ({ value, label: HOW_LABEL[value] }));
const TEXT = '__text__';

type Transform = PageRecipeSpec['transform'];

function RowEditor({ row, n, sources, value, onChange, onRemove }: {
    row: MappingRow; n: number; sources: { key: string; label: string; from: MappingFrom }[]; value: unknown;
    onChange: (row: MappingRow) => void; onRemove: () => void;
}) {
    const fromValue = row.from.kind === 'text' ? TEXT : fromKey(row.from);
    const options = [
        ...sources.map(s => ({ value: s.key, label: s.label })),
        ...(row.from.kind !== 'text' && !sources.some(s => s.key === fromValue) ? [{ value: fromValue, label: `${sources.length ? '(not on the page) ' : ''}${fromValue}` }] : []),
        { value: TEXT, label: 'Fixed text…' },
    ];
    const pick = (key: string) => {
        if (key === TEXT) { onChange({ ...row, from: { kind: 'text', text: '' } }); return; }
        const s = sources.find(x => x.key === key);
        if (s) onChange({ ...row, from: s.from });
    };
    const how = row.how ?? 'as-is';
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line px-2.5 py-2" data-testid="pro-mapping-row">
            <div className="flex items-end gap-1.5">
                <TextField size="sm" className="flex-1" aria-label={`Output ${n}`} placeholder="offer.price" value={row.output}
                    onChange={e => onChange({ ...row, output: e.target.value })} />
                <Text size="caption" tone="faint" className="pb-1.5">←</Text>
                <Select size="sm" className="flex-[2]" aria-label={`From ${n}`} value={fromValue} options={options} onChange={pick} />
                <IconButton size="sm" label={`Remove row ${n}`} onClick={onRemove}><Trash2 /></IconButton>
            </div>
            {row.from.kind === 'text' && (
                <TextField size="sm" aria-label={`Text ${n}`} placeholder="walmart" value={row.from.text}
                    onChange={e => onChange({ ...row, from: { kind: 'text', text: e.target.value } })} />
            )}
            <div className="flex flex-wrap items-end gap-1.5">
                <Select<MappingHow> size="sm" aria-label={`How ${n}`} value={how} options={HOWS}
                    onChange={h => { const { how: _h, sep: _s, ...rest } = row; onChange({ ...rest, ...(h === 'as-is' ? {} : { how: h }), ...(h === 'join' ? { sep: row.sep ?? ', ' } : h === 'split' ? { sep: row.sep ?? ',' } : {}) }); }} />
                {(how === 'join' || how === 'split') && (
                    <TextField size="sm" className="w-20" aria-label={`Separator ${n}`} value={row.sep ?? ''}
                        onChange={e => onChange({ ...row, sep: e.target.value })} />
                )}
                <TextField size="sm" className="w-28" aria-label={`Default ${n}`} placeholder="default" value={row.default === undefined ? '' : String(row.default)}
                    onChange={e => { const { default: _d, ...rest } = row; onChange(e.target.value === '' ? rest : { ...rest, default: e.target.value }); }} />
            </div>
            <Text size="caption" tone={value === undefined || value === null ? 'faint' : 'muted'} className="break-all" data-testid="pro-mapping-value">= {short(value)}</Text>
        </div>
    );
}

export function TransformPanel({ transform, fields, sample, contract, onChange, onValid }: {
    transform?: Transform;
    /** The recipe's field names. */
    fields: string[];
    /** The record of the page last tested on (fields by name), to show the output on. */
    sample?: Record<string, unknown>;
    /** The recipe's output contract: its fields are what "Propose" maps to. */
    contract?: Contract;
    onChange: (jolt: JoltOperation[] | undefined, mapping?: MappingRow[]) => void;
    /** False while the JOLT text is not a chain that can be saved. */
    onValid: (valid: boolean) => void;
}) {
    const rows = transform?.mapping;
    const handWritten = !!transform && !rows;
    const [tab, setTab] = useState<'mapping' | 'jolt'>(handWritten ? 'jolt' : 'mapping');
    const [text, setText] = useState(transform ? pretty(transform.jolt) : '');
    const problems = text.trim() ? joltProblems(text) : [];
    useEffect(() => onValid(problems.length === 0), [problems.length]);
    // The JOLT text follows the rows while they are what it is.
    const compiled = rows ? JSON.stringify(transform!.jolt) : null;
    useEffect(() => { if (compiled !== null) setText(pretty(JSON.parse(compiled))); }, [compiled]);

    const setRows = (next: MappingRow[]) => {
        if (next.length) { onChange(compileMapping(next), next); return; }
        setText('');
        onChange(undefined);
    };
    const editText = (next: string) => {
        setText(next);
        if (!next.trim()) { onChange(undefined); return; }
        if (joltProblems(next).length) return;
        const v = JSON.parse(next);
        onChange(Array.isArray(v) ? v : [v]);
    };

    const sources = mappingSources(fields, sample).map(s => ({ key: fromKey(s.from), label: s.label, from: s.from }));
    const proposed = contract ? proposeMapping(contract, fields, sample) : [];
    const fromFields = fields.map((f): MappingRow => ({ output: f, from: { kind: 'field', field: f } }));

    let output: { value?: unknown; error?: string } | null = null;
    if (sample && transform?.jolt.length && !problems.length) {
        if (rows) output = mappingOutput(rows, sample);
        else try { output = { value: joltTransform(structuredClone(sample), transform.jolt) }; } catch (e) { output = { error: e instanceof Error ? e.message : String(e) }; }
    }

    const starts = (
        <div className="flex flex-wrap gap-1.5">
            {contract && (
                <Button size="sm" variant="secondary" icon={<Sparkles />} disabled={!proposed.length} onClick={() => setRows(proposed)}>
                    Propose from {contract.label}
                </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Shuffle />} disabled={!fields.length} onClick={() => setRows(fromFields)}>Start from the fields</Button>
        </div>
    );

    return (
        <div className="flex flex-col gap-2 pt-2" data-testid="pro-transform">
            <Segmented tabs size="sm" aria-label="Transform as" value={tab} onChange={setTab}
                options={[{ value: 'mapping', label: 'Mapping' }, { value: 'jolt', label: 'JOLT' }]} />
            {tab === 'mapping' && (
                <div className="flex flex-col gap-2" data-testid="pro-mapping">
                    <Text size="caption" tone="faint">
                        Each row is one value of the output: where it goes (dots nest it), what it reads, and how.
                        {contract ? ` "Propose" fills the rows for ${contract.label} from the fields' names and the tested page's values.` : ' Choose an output contract to have the rows proposed.'}
                    </Text>
                    {handWritten && <Notice tone="info">This transform is written in JOLT (see the JOLT tab). Starting rows here replaces it.</Notice>}
                    {!rows && starts}
                    {contract && !sample && !rows && <Text size="caption" tone="faint">Test on a page first: proposals then read keys and columns too, and check each value fits.</Text>}
                    {rows?.map((row, i) => (
                        <RowEditor key={i} row={row} n={i + 1} sources={sources} value={output?.value === undefined ? undefined : valueAt(output.value, row.output)}
                            onChange={r => setRows(rows.map((x, j) => j === i ? r : x))} onRemove={() => setRows(rows.filter((_, j) => j !== i))} />
                    ))}
                    {rows && (
                        <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="ghost" icon={<Plus />}
                                onClick={() => setRows([...rows, { output: '', from: sources[0]?.from ?? { kind: 'text', text: '' } }])}>Add row</Button>
                            {contract && proposed.some(p => !rows.some(r => r.output === p.output)) && (
                                <Button size="sm" variant="ghost" icon={<Sparkles />}
                                    onClick={() => setRows([...rows, ...proposed.filter(p => !rows.some(r => r.output === p.output))])}>Add what {contract.label} still needs</Button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {tab === 'jolt' && (
                <div className="flex flex-col gap-2">
                    <Text size="caption" tone="faint">
                        {rows ? 'The JOLT chain the rows compile to. Editing it here keeps it as JOLT and drops the rows.'
                            : 'The page\'s record goes through this JOLT chain, as in Atlas: shift, default, remove, cardinality, sort, modify-overwrite-beta / modify-default-beta / modify-define-beta.'}
                    </Text>
                    {!text.trim() && starts}
                    <TextArea label="JOLT spec (JSON: one operation or a list)" rows={text.trim() ? 10 : 3} value={text}
                        mono placeholder='[{ "operation": "shift", "spec": { "title": "product.name" } }]'
                        onChange={e => editText(e.target.value)} />
                    {problems.map(p => <Text key={p} size="caption" tone="warning">{p}</Text>)}
                </div>
            )}
            {output && (
                <div className="flex flex-col gap-1 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-transform-output">
                    <Text size="caption" tone="muted">The output on the tested page</Text>
                    {output.error
                        ? <Text size="caption" tone="danger">{output.error}</Text>
                        : <pre className="max-h-64 overflow-auto font-mono text-caption whitespace-pre-wrap break-all">{pretty(output.value)}</pre>}
                </div>
            )}
            {!sample && transform && <Text size="caption" tone="faint">Test on a page to see the output here.</Text>}
            {transform && <div><Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => { setText(''); onChange(undefined); }}>Remove the transform</Button></div>}
        </div>
    );
}
