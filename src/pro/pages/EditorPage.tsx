/**
 * The fields panel (`docs/design/LLD.md` §10): a page recipe's latest version, edited without the page.
 * Each field can be renamed, typed, required, moved or removed; its selectors moved, removed or added;
 * its cleanup steps set and tried on a value. Saving writes the next version with a note. Picking new
 * fields on the page stays in the Page Extractor (Re-pick).
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Crosshair, MousePointerClick, Save, Trash2 } from 'lucide-react';
import ToolHeader from '../../sidepanel/components/ui/ToolHeader';
import { Button, Chip, Disclosure, IconButton, Notice, Select, Switch, Text, TextArea, TextField } from '../../sidepanel/ui';
import { pro } from '../db';
import { saveSpecVersion, setProEdit } from '../edit';
import { openedRecipe } from '../nav';
import { diffVersions, wayLabel } from '../recipe/diff';
import * as edits from '../recipe/editSpec';
import { applyProOps, NEW_OP, opSummary, PRO_OP_LABELS, type ProOp } from '../recipe/ops';
import type { Click, Field, FieldType, PageRecipeSpec, ProRecipe, Version } from '../recipe/types';

interface Props {
    onBack: () => void;
    onNavigate: (view: string) => void;
}

const TYPES: FieldType[] = ['text', 'number', 'integer', 'money', 'date', 'url', 'boolean', 'enum', 'list', 'object', 'table'];

/** The settings a step has, as small text boxes. */
function OpSettings({ op, onChange }: { op: ProOp; onChange: (op: ProOp) => void }) {
    const text = (label: string, value: string, set: (v: string) => ProOp) =>
        <TextField key={label} size="sm" className="flex-1" label={label} value={value} onChange={e => onChange(set(e.target.value))} />;
    switch (op.op) {
        case 'regex': return <div className="flex gap-2">{text('Pattern', op.pattern, pattern => ({ ...op, pattern }))}</div>;
        case 'replace': return <div className="flex gap-2">{text('Find', op.find, find => ({ ...op, find }))}{text('With', op.with, w => ({ ...op, with: w }))}</div>;
        case 'split': return <div className="flex gap-2">{text('Separator', op.sep, sep => ({ ...op, sep }))}{text('Part #', String(op.index), i => ({ ...op, index: Number(i) || 0 }))}</div>;
        case 'prefix': case 'suffix': return <div className="flex gap-2">{text('Text', op.text, t => ({ ...op, text: t }))}</div>;
        case 'splitList': case 'toObject': return <div className="flex gap-2">{text(op.op === 'splitList' ? 'Split on' : 'Name and value split on', op.sep, sep => ({ ...op, sep }))}</div>;
        default: return null;
    }
}

function Cleanup({ field, onChange }: { field: Field; onChange: (ops: ProOp[]) => void }) {
    const [sample, setSample] = useState('');
    const result = sample ? applyProOps(sample.replace(/\\n/g, '\n'), field.ops) : null;
    return (
        <div className="flex flex-col gap-2">
            <Text size="caption" weight="semibold" tone="muted">Cleanup, in order</Text>
            {field.ops.length === 0 && <Text size="caption" tone="faint">None: the value is kept as found.</Text>}
            {field.ops.map((op, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <div><Chip tone="outline" onRemove={() => onChange(field.ops.filter((_, j) => j !== i))} removeLabel={`Remove ${PRO_OP_LABELS[op.op]}`}>{opSummary(op)}</Chip></div>
                    <OpSettings op={op} onChange={next => onChange(field.ops.map((o, j) => j === i ? next : o))} />
                </div>
            ))}
            <Select<ProOp['op'] | ''> size="sm" aria-label="Add a step" value=""
                options={[{ value: '', label: '+ Add a step' }, ...(Object.keys(NEW_OP) as ProOp['op'][]).map(k => ({ value: k, label: PRO_OP_LABELS[k] }))]}
                onChange={k => { if (k) onChange([...field.ops, NEW_OP[k]]); }} />
            <TextField size="sm" label="Try on a value" hint="\n is a new line." value={sample} onChange={e => setSample(e.target.value)} placeholder="Fit: Relaxed\nLength: Regular" />
            {sample && <Text size="caption" mono className="break-all" data-testid="pro-try-result">→ {typeof result === 'string' ? result : JSON.stringify(result)}</Text>}
        </div>
    );
}

function Ways({ ways, onMove, onRemove, onAdd }: { ways: Field['ways']; onMove: (i: number, d: number) => void; onRemove: (i: number) => void; onAdd: (s: string) => void }) {
    const [adding, setAdding] = useState('');
    const firstSelector = ways.findIndex(w => w.kind === 'selector');
    return (
        <div className="flex flex-col gap-1.5">
            <Text size="caption" weight="semibold" tone="muted">Ways to find it, first that works wins</Text>
            {ways.map((w, i) => (
                <div key={`${i}-${wayLabel(w)}`} className="flex items-center gap-1.5">
                    <Chip tone={w.kind === 'data' ? 'info' : 'neutral'}>{w.kind === 'data' ? 'Page data' : 'Selector'}</Chip>
                    <Text size="caption" mono className="min-w-0 flex-1 break-all">{wayLabel(w)}</Text>
                    {w.kind === 'selector' && <>
                        <IconButton size="sm" label="Try it earlier" onClick={() => onMove(i, -1)} disabled={i <= firstSelector}><ArrowUp /></IconButton>
                        <IconButton size="sm" label="Try it later" onClick={() => onMove(i, 1)} disabled={i === ways.length - 1}><ArrowDown /></IconButton>
                    </>}
                    <IconButton size="sm" label={`Remove way ${i + 1}`} onClick={() => onRemove(i)}><Trash2 /></IconButton>
                </div>
            ))}
            <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); onAdd(adding); setAdding(''); }}>
                <TextField size="sm" className="flex-1" aria-label="Add a selector" placeholder="Add a selector (CSS or XPath)" value={adding} onChange={e => setAdding(e.target.value)} />
                <Button size="sm" variant="ghost" type="submit" disabled={!adding.trim()}>Add</Button>
            </form>
        </div>
    );
}

export default function EditorPage({ onBack, onNavigate }: Props) {
    const [recipeId] = useState(openedRecipe);
    const [recipe, setRecipe] = useState<ProRecipe | null>(null);
    const [base, setBase] = useState<Version | null>(null);
    const [spec, setSpec] = useState<PageRecipeSpec | null>(null);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!recipeId) return;
        void (async () => {
            const r = await pro.recipes.get(recipeId);
            const v = r && await pro.versions.get(r.id, r.latestVersion);
            setRecipe(r ?? null);
            setBase(v ?? null);
            if (v?.spec.kind === 'page') setSpec(v.spec);
        })();
    }, [recipeId]);

    const changes = useMemo(() => base && spec ? diffVersions(base, { ...base, spec, version: base.version + 1 }).changes : [], [base, spec]);
    const blockers = spec ? edits.problems(spec) : [];

    const repick = () => {
        if (!recipe || !base) return;
        setProEdit({ kind: recipe.kind, recipe, version: base });
        onNavigate(recipe.kind === 'page' ? 'page-extractor' : 'list-extractor');
    };

    const save = async () => {
        if (!recipe || !base || !spec) return;
        setSaving(true);
        setError(null);
        try {
            await saveSpecVersion(recipe, base, spec, note);
            onNavigate('pro-history');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    const header = (
        <ToolHeader title="Edit fields" subtitle={recipe && base ? `${recipe.name} · from v${base.version}` : undefined} onBack={onBack}
            actions={recipe && <Button size="sm" variant="ghost" icon={<Crosshair />} onClick={repick}>Re-pick on page</Button>} />
    );
    if (!recipe || !base) return <div className="flex h-full flex-col">{header}</div>;
    if (!spec) {
        return (
            <div className="flex h-full flex-col">{header}
                <div className="p-4"><Notice tone="info" action={<Button size="sm" onClick={repick}>Re-pick on page</Button>}>A list recipe's fields are edited by picking the list again.</Notice></div>
            </div>
        );
    }

    const fieldCard = (field: Field, i: number) => (
        <div key={field.id} data-testid="pro-field"><Disclosure
            summary={<span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold">{field.name || 'unnamed'}</span><Chip>{field.type}</Chip>{field.required && <Chip tone="warning">required</Chip>}</span>}
            meta={<Text size="caption" tone="faint">{field.ways.length} way{field.ways.length === 1 ? '' : 's'}{field.ops.length ? ` · ${field.ops.length} cleanup` : ''}</Text>}>
            <div className="flex flex-col gap-3 pt-2">
                <div className="flex items-end gap-2">
                    <TextField size="sm" className="flex-1" label="Name" value={field.name} onChange={e => setSpec(edits.renameField(spec, field.id, e.target.value))} />
                    <Select size="sm" label="Type" value={field.type} options={TYPES.map(t => ({ value: t, label: t }))} onChange={t => setSpec(edits.setFieldType(spec, field.id, t))} />
                </div>
                <div className="flex items-center gap-1">
                    <Switch label="Required" checked={!!field.required} onChange={r => setSpec(edits.setRequired(spec, field.id, r))} />
                    <span className="flex-1" />
                    <IconButton size="sm" label="Move up" onClick={() => setSpec(edits.moveStep(spec, i, -1))} disabled={i === 0}><ArrowUp /></IconButton>
                    <IconButton size="sm" label="Move down" onClick={() => setSpec(edits.moveStep(spec, i, 1))} disabled={i === spec.steps.length - 1}><ArrowDown /></IconButton>
                    <IconButton size="sm" label={`Remove field ${field.name}`} onClick={() => setSpec(edits.removeStep(spec, i))}><Trash2 /></IconButton>
                </div>
                <Ways ways={field.ways}
                    onMove={(w, d) => setSpec(edits.moveWay(spec, field.id, w, d))}
                    onRemove={w => setSpec(edits.removeWay(spec, field.id, w))}
                    onAdd={s => setSpec(edits.addSelector(spec, field.id, s))} />
                <Cleanup field={field} onChange={ops => setSpec(edits.setOps(spec, field.id, ops))} />
            </div>
        </Disclosure></div>
    );

    const clickRow = (click: Click, i: number) => (
        <div key={click.id} className="flex items-center gap-2 rounded-card border border-dashed border-line px-3 py-2">
            <MousePointerClick size={16} className="shrink-0 text-ink-2" />
            <Text size="small" className="min-w-0 flex-1 truncate">Click {click.ways[0] ? wayLabel(click.ways[0]) : click.name}</Text>
            <IconButton size="sm" label="Move up" onClick={() => setSpec(edits.moveStep(spec, i, -1))} disabled={i === 0}><ArrowUp /></IconButton>
            <IconButton size="sm" label="Move down" onClick={() => setSpec(edits.moveStep(spec, i, 1))} disabled={i === spec.steps.length - 1}><ArrowDown /></IconButton>
            <IconButton size="sm" label="Remove click" onClick={() => setSpec(edits.removeStep(spec, i))}><Trash2 /></IconButton>
        </div>
    );

    return (
        <div className="flex h-full flex-col">
            {header}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
                <Text size="caption" tone="faint">Steps run in this order: a click, then the fields it reveals.</Text>
                {spec.steps.map((s, i) => s.kind === 'field' ? fieldCard(s.field, i) : clickRow(s.click, i))}
            </div>
            <div className="flex flex-col gap-2 border-t border-line bg-bg p-4">
                {blockers.length > 0 && <Notice tone="warning">{blockers.join(' ')}</Notice>}
                {error && <Notice tone="danger">{error}</Notice>}
                <Text size="caption" tone="muted" data-testid="pro-editor-changes">{changes.length === 0 ? 'No changes yet.' : `${changes.length} change${changes.length === 1 ? '' : 's'}: ${changes.map(c => c.subject).join(', ')}`}</Text>
                <TextArea label="What changed" rows={2} value={note} onChange={e => setNote(e.target.value)} />
                <Button variant="primary" icon={<Save />} loading={saving} disabled={changes.length === 0 || blockers.length > 0} onClick={save}>Save version {base.version + 1}</Button>
            </div>
        </div>
    );
}
