/**
 * The fields panel (`docs/design/LLD.md` §10): a page recipe's latest version, edited without the page.
 * Each field can be renamed, typed, required, moved or removed; its selectors moved, removed or added, and
 * each way's reading, pick, condition and own cleanup set; its cleanup steps set and tried on a value. The
 * page rules and the identity check are edited here too. Saving writes the next version with a note.
 * Picking new fields on the page stays in the Page Extractor (Re-pick).
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Crosshair, ExternalLink, FileCheck, Fingerprint, FlaskConical, Layers, Plus, Save, ShieldAlert, SlidersHorizontal, Trash2, X } from 'lucide-react';
import ToolHeader from '../../sidepanel/components/ui/ToolHeader';
import { Button, Chip, Disclosure, IconButton, Notice, Select, Switch, Text, TextArea, TextField } from '../../sidepanel/ui';
import { pro } from '../db';
import { saveSpecVersion, setProEdit } from '../edit';
import { openedRecipe, takeRepair, type Repair } from '../nav';
import { usePageTab } from '../../sidepanel/hooks/usePageTab';
import { specDigest } from '../recipe/canonical';
import { passed } from '../db/tests';
import { summarize, testOnTab, type FieldResult, type PageResult } from '../runner/testPage';
import { testOnPages, type PagesProgress } from '../runner/testPages';
import { TestGrid } from './TestGrid';
import { ConditionEditor } from './ConditionEditor';
import { describe, newLeaf } from '../recipe/conditions';
import { expectations, RULE_STATUS_LABELS } from '../runner/outcome';
import { ContractPanel } from './ContractPanel';
import { BeforeReading, newStep, PageAction, usePicker } from './StepsCard';
import { Ways } from './Ways';
import { MarkupSource } from './MarkupSource';
import { readiness } from '../recipe/ready';
import { diffVersions } from '../recipe/diff';
import * as edits from '../recipe/editSpec';
import { applyProOps, NEW_OP, opSummary, PRO_OP_LABELS, type ProOp } from '../recipe/ops';
import type { Field, FieldType, Identity, OutputSpec, PageRecipeSpec, ProRecipe, Sample, Version, Way, WayPick } from '../recipe/types';
import type { PageRule, RuleStatus, WayRead } from '../../shared/types/ways';

interface Props {
    onBack: () => void;
    onNavigate: (view: string) => void;
}

/** A value in one line: text as is, anything else as JSON. */
const preview = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

/** A field's result on the tested page, as a chip. */
function ResultChip({ result }: { result?: FieldResult }) {
    if (!result) return null;
    if (!result.ok) return <Chip tone="danger">{result.problem}</Chip>;
    return result.filled ? <Chip tone="success">found</Chip> : <Chip>empty</Chip>;
}

/** Sample pages a multi-page test reads, at most. */
const TEST_PAGES = 5;

const shortUrl = (url: string) => { try { const u = new URL(url); return u.host + u.pathname + u.search; } catch { return url; } };

const TYPES: FieldType[] = ['text', 'number', 'integer', 'money', 'date', 'url', 'boolean', 'enum', 'list', 'object', 'table'];

/** The settings a step has, as small text boxes. */
function OpSettings({ op, onChange }: { op: ProOp; onChange: (op: ProOp) => void }) {
    const text = (label: string, value: string, set: (v: string) => ProOp) =>
        <TextField key={label} size="sm" className="flex-1" label={label} value={value} onChange={e => onChange(set(e.target.value))} />;
    switch (op.op) {
        case 'regex': return <div className="flex gap-2">{text('Pattern', op.pattern, pattern => ({ ...op, pattern }))}<TextField size="sm" className="w-16" label="Flags" value={op.flags ?? 'i'} onChange={e => onChange({ ...op, flags: e.target.value })} /></div>;
        case 'replace': return <div className="flex gap-2">{text('Find', op.find, find => ({ ...op, find }))}{text('With', op.with, w => ({ ...op, with: w }))}</div>;
        case 'split': return <div className="flex gap-2">{text('Separator', op.sep, sep => ({ ...op, sep }))}{text('Part #', String(op.index), i => ({ ...op, index: Number(i) || 0 }))}</div>;
        case 'prefix': case 'suffix': return <div className="flex gap-2">{text('Text', op.text, t => ({ ...op, text: t }))}</div>;
        case 'splitList': case 'toObject': return <div className="flex gap-2">{text(op.op === 'splitList' ? 'Split on' : 'Name and value split on', op.sep, sep => ({ ...op, sep }))}</div>;
        case 'join': return <div className="flex gap-2">{text('Joined with', op.sep, sep => ({ ...op, sep }))}</div>;
        case 'lua': return <TextArea label="Lua: the value is str, the first value returned is kept" rows={3} value={op.code} onChange={e => onChange({ ...op, code: e.target.value })} />;
        default: return null;
    }
}

function Cleanup({ ops, onChange, title = 'Cleanup, in order', empty = 'None: the value is kept as found.' }: { ops: ProOp[]; onChange: (ops: ProOp[]) => void; title?: string; empty?: string }) {
    const [sample, setSample] = useState('');
    const result = sample ? applyProOps(sample.replace(/\\n/g, '\n'), ops) : null;
    return (
        <div className="flex flex-col gap-2">
            <Text size="caption" weight="semibold" tone="muted">{title}</Text>
            {ops.length === 0 && <Text size="caption" tone="faint">{empty}</Text>}
            {ops.map((op, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <div><Chip tone="outline" onRemove={() => onChange(ops.filter((_, j) => j !== i))} removeLabel={`Remove ${PRO_OP_LABELS[op.op]}`}>{opSummary(op)}</Chip></div>
                    <OpSettings op={op} onChange={next => onChange(ops.map((o, j) => j === i ? next : o))} />
                </div>
            ))}
            <Select<ProOp['op'] | ''> size="sm" aria-label="Add a step" value=""
                options={[{ value: '', label: '+ Add a step' }, ...(Object.keys(NEW_OP) as ProOp['op'][]).map(k => ({ value: k, label: PRO_OP_LABELS[k] }))]}
                onChange={k => { if (k) onChange([...ops, NEW_OP[k]]); }} />
            <TextField size="sm" label="Try on a value" hint="\n is a new line." value={sample} onChange={e => setSample(e.target.value)} placeholder="Fit: Relaxed\nLength: Regular" />
            {sample && <Text size="caption" mono className="break-all" data-testid="pro-try-result">→ {typeof result === 'string' ? result : JSON.stringify(result)}</Text>}
        </div>
    );
}

const READS: { value: WayRead | ''; label: string }[] = [
    { value: '', label: 'As the field reads' }, { value: 'text', label: 'Its text' }, { value: 'attr', label: 'An attribute' },
    { value: 'html', label: 'Its HTML' }, { value: 'count', label: 'How many match' }, { value: 'pairs', label: 'Name/value pairs' },
];
const PICKS: { value: WayPick; label: string }[] = [
    { value: 'first', label: 'The first match' }, { value: 'firstFilled', label: 'The first that cleans to a value' }, { value: 'all', label: 'Every match' },
];

/** The way with these options set; an option back at its default is dropped, so the digest stays as it was. */
function patchWay(way: Way, changes: Record<string, unknown>): Way {
    const next: Record<string, unknown> = { ...way, ...changes };
    for (const [k, v] of Object.entries(changes)) if (v === undefined || v === '' || v === 'first' || (Array.isArray(v) && v.length === 0)) delete next[k];
    return next as unknown as Way;
}

function WayEditor({ way, onChange }: { way: Way; onChange: (w: Way) => void }) {
    const set = (changes: Record<string, unknown>) => onChange(patchWay(way, changes));
    return (
        <div className="flex flex-col gap-2 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-way-editor">
            {way.kind === 'selector' && <>
                <div className="flex items-end gap-2">
                    <Select<WayRead | ''> size="sm" label="Reads" value={way.read ?? ''} options={READS}
                        onChange={read => set({ read, attr: read === 'attr' || read === 'pairs' ? way.attr : undefined, pairs: read === 'pairs' ? way.pairs ?? {} : undefined })} />
                    {(way.read === 'attr' || way.read === 'pairs') && <TextField size="sm" className="flex-1" label={way.read === 'pairs' ? 'Value from attribute' : 'Attribute'}
                        value={way.attr ?? ''} onChange={e => set({ attr: e.target.value })} />}
                </div>
                {way.read === 'pairs' && <div className="flex gap-2">
                    <TextField size="sm" className="flex-1" label="Name inside it" placeholder="the match itself" value={way.pairs?.key ?? ''}
                        onChange={e => set({ pairs: patchPairs(way.pairs, 'key', e.target.value) })} />
                    <TextField size="sm" className="flex-1" label="Value inside it" placeholder="the match itself" value={way.pairs?.value ?? ''}
                        onChange={e => set({ pairs: patchPairs(way.pairs, 'value', e.target.value) })} />
                </div>}
            </>}
            {!(way.kind === 'selector' && (way.read === 'pairs' || way.read === 'count')) &&
                <Select<WayPick> size="sm" label="Keeps" value={way.pick ?? 'first'} options={PICKS} onChange={pick => set({ pick })} />}
            {way.when
                ? <div className="flex flex-col gap-1.5" data-testid="pro-way-when">
                    <div className="flex items-center gap-1.5">
                        <Text size="caption" weight="semibold" tone="muted" className="flex-1">Only tried when…</Text>
                        <Button size="sm" variant="ghost" onClick={() => set({ when: undefined })}>Always try it</Button>
                    </div>
                    <ConditionEditor value={way.when} where="This way" onChange={when => set({ when })} />
                </div>
                : <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => set({ when: newLeaf() })}>Only try it when…</Button></div>}
            <Cleanup ops={way.ops ?? []} onChange={ops => set({ ops })} title="This way's cleanup, before the field's" empty="None." />
        </div>
    );
}

const patchPairs = (pairs: { key?: string; value?: string } | undefined, key: 'key' | 'value', v: string) => {
    const next = { ...pairs, [key]: v.trim() || undefined };
    if (!next[key]) delete next[key];
    return next;
};

const STATUS_LABELS = RULE_STATUS_LABELS;
const STATUSES = (Object.keys(STATUS_LABELS) as RuleStatus[]).map(value => ({ value, label: STATUS_LABELS[value] }));
/**
 * Page rules: checked in order before any field; the first that holds says what the page is (a 404, out of stock, a
 * captcha) and nothing is read. Each has a name, a status and a condition (`ConditionEditor`): tests on the visible
 * text, elements, the URL, the title or the HTML, grouped as all / any / none of them.
 */
function PageRules({ rules, onChange }: { rules: PageRule[]; onChange: (rules: PageRule[]) => void }) {
    const [open, setOpen] = useState<number | null>(null);
    const set = (i: number, r: PageRule) => onChange(rules.map((x, j) => j === i ? r : x));
    const move = (i: number, d: number) => {
        const next = [...rules];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange(next);
        setOpen(o => o === i ? i + d : o === i + d ? i : o);
    };
    const add = () => {
        let n = rules.length + 1;
        while (rules.some(r => r.name === `Rule ${n}`)) n++;
        onChange([...rules, { name: `Rule ${n}`, status: 'not_found', when: newLeaf() }]);
        setOpen(rules.length);
    };
    return (
        <div className="flex flex-col gap-2 pt-2" data-testid="pro-page-rules">
            <Text size="caption" tone="faint">Checked in order before any field is read: the first that holds marks the page and nothing is read.</Text>
            {rules.map((r, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-line p-2" data-testid="pro-page-rule">
                    <div className="flex items-end gap-1.5">
                        <TextField size="sm" className="min-w-0 flex-1" aria-label={`Name of rule ${i + 1}`} value={r.name}
                            onChange={e => set(i, { ...r, name: e.target.value })} />
                        <Select<RuleStatus> size="sm" aria-label={`Status of ${r.name || `rule ${i + 1}`}`} value={r.status} options={STATUSES}
                            onChange={st => set(i, { ...r, status: st })} />
                    </div>
                    <div className="flex items-center gap-1">
                        {open === i ? <span className="flex-1" /> : (
                            <Text size="caption" tone="muted" className="min-w-0 flex-1 break-words" lines={2} data-testid="pro-rule-sentence">
                                When {describe(r.when)}
                            </Text>
                        )}
                        <IconButton size="sm" label={`Check ${r.name || `rule ${i + 1}`} earlier`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></IconButton>
                        <IconButton size="sm" label={`Check ${r.name || `rule ${i + 1}`} later`} onClick={() => move(i, 1)} disabled={i === rules.length - 1}><ArrowDown /></IconButton>
                        <IconButton size="sm" label={`Remove rule ${r.name || i + 1}`} onClick={() => { onChange(rules.filter((_, j) => j !== i)); setOpen(null); }}><Trash2 /></IconButton>
                    </div>
                    {open === i
                        ? <>
                            <ConditionEditor value={r.when} where={`Rule "${r.name}"`} onChange={when => set(i, { ...r, when })} />
                            <div><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Done</Button></div>
                        </>
                        : <div><Button size="sm" variant="ghost" icon={<SlidersHorizontal />} onClick={() => setOpen(i)}>Edit condition</Button></div>}
                </div>
            ))}
            <div><Button size="sm" variant="secondary" icon={<Plus />} onClick={add}>Add a rule</Button></div>
        </div>
    );
}

/** The identity check: a field compared with the id its URL names. */
function IdentityCheck({ identity, fields, onChange }: { identity?: Identity; fields: string[]; onChange: (identity: Identity | undefined) => void }) {
    const [patterns, setPatterns] = useState(identity?.url.join('\n') ?? '');
    if (!identity) {
        return <div className="pt-2"><Button size="sm" variant="ghost" icon={<Plus />} disabled={!fields.length}
            onClick={() => { setPatterns(''); onChange({ field: fields.find(f => /sku|id/i.test(f)) ?? fields[0], url: [] }); }}>Check a field against the URL</Button></div>;
    }
    return (
        <div className="flex flex-col gap-2 pt-2" data-testid="pro-identity">
            <Text size="caption" tone="faint">A page whose field differs from what the patterns find in its URL is another product.</Text>
            <div className="flex items-end gap-2">
                <Select size="sm" label="Field" value={identity.field} options={fields.map(f => ({ value: f, label: f }))} onChange={field => onChange({ ...identity, field })} />
                <span className="flex-1" />
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => onChange(undefined)}>Remove</Button>
            </div>
            <TextArea label="URL patterns (regex, one per line; the first match is the id)" rows={2} value={patterns}
                onChange={e => { setPatterns(e.target.value); onChange({ ...identity, url: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }); }} />
        </div>
    );
}

export default function EditorPage({ onBack, onNavigate }: Props) {
    const [recipeId] = useState(openedRecipe);
    const [repair] = useState<Repair | null>(() => recipeId ? takeRepair(recipeId) : null);
    const repairing = new Set(repair?.fields.map(f => f.name));
    const [recipe, setRecipe] = useState<ProRecipe | null>(null);
    const [base, setBase] = useState<Version | null>(null);
    const [spec, setSpec] = useState<PageRecipeSpec | null>(null);
    const [output, setOutput] = useState<OutputSpec>({});
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const page = usePageTab();
    const [test, setTest] = useState<{ result: PageResult; spec: string } | null>(null);
    /** Test values of the recipe's variables ({zip}), kept per recipe on this browser. */
    const [context, setContext] = useState<Record<string, string>>({});
    const picker = usePicker();
    const [testing, setTesting] = useState(false);
    const [samples, setSamples] = useState<Sample[]>([]);
    const [pagesTest, setPagesTest] = useState<{ results: PageResult[]; spec: string } | null>(null);
    const [progress, setProgress] = useState<PagesProgress | null>(null);

    useEffect(() => {
        if (!recipeId) return;
        void (async () => {
            const r = await pro.recipes.get(recipeId);
            const v = r && await pro.versions.get(r.id, r.latestVersion);
            setRecipe(r ?? null);
            setBase(v ?? null);
            if (v?.spec.kind === 'page') setSpec(v.spec);
            if (v) setOutput(v.output);
            if (r) setSamples(await pro.samples.list(r.id));
            if (r) {
                const key = `pro.testContext.${r.id}`;
                const saved = (await chrome.storage.local.get(key))[key];
                if (saved && typeof saved === 'object') setContext(saved as Record<string, string>);
            }
        })();
    }, [recipeId]);
    const changeContext = (next: Record<string, string>) => {
        setContext(next);
        if (recipe) void chrome.storage.local.set({ [`pro.testContext.${recipe.id}`]: next });
    };

    const changes = useMemo(() => base && spec ? diffVersions(base, { ...base, spec, output, version: base.version + 1 }).changes : [], [base, spec, output]);
    const blockers = spec ? edits.problems(spec) : [];

    const repick = () => {
        if (!recipe || !base) return;
        setProEdit({ kind: recipe.kind, recipe, version: base });
        onNavigate(recipe.kind === 'page' ? 'page-extractor' : 'list-extractor');
    };

    /** Runs the spec as it is now on the open page, and keeps the run for this spec's digest. */
    const runTest = async () => {
        if (!recipe || !base || !spec || !page.tab?.id) return;
        setTesting(true);
        const result = await testOnTab(page.tab.id, page.url, spec, base.settings, context);
        setTest({ result, spec: JSON.stringify(spec) });
        await pro.tests.save({ recipeId: recipe.id, digest: await specDigest(spec), kind: 'page', results: [result], passed: passed([result]), at: Date.now() });
        setTesting(false);
    };
    /** A page a failing field failed on: opened in the page's tab, and kept as a sample to test on. */
    const openFailing = async (url: string) => {
        if (page.tab?.id) await chrome.tabs.update(page.tab.id, { url });
        if (!samples.some(x => x.url === url)) await addSample(url);
    };

    const addSample = async (url: string) => {
        if (!recipe) return;
        await pro.samples.add(recipe.id, [url]);
        setSamples(await pro.samples.list(recipe.id));
    };
    /** The page rule a sample should hit, or none: a page to read. */
    const expectSample = async (url: string, rule: string | undefined) => {
        if (!recipe) return;
        await pro.samples.expectRule(recipe.id, url, rule);
        setSamples(await pro.samples.list(recipe.id));
    };
    const removeSample = async (url: string) => {
        if (!recipe) return;
        await pro.samples.remove(recipe.id, url);
        setSamples(await pro.samples.list(recipe.id));
    };

    /** Runs the spec on the first sample pages, in background tabs, and keeps the run for its digest. */
    const runPagesTest = async () => {
        if (!recipe || !base || !spec) return;
        const tested = spec;
        const results = await testOnPages(samples.slice(0, TEST_PAGES).map(x => x.url), tested, base.settings, setProgress, undefined, context);
        setProgress(null);
        setPagesTest({ results, spec: JSON.stringify(tested) });
        await pro.tests.save({ recipeId: recipe.id, digest: await specDigest(tested), kind: 'pages', results, passed: passed(results, samples), at: Date.now() });
    };
    const pagesStale = !!pagesTest && pagesTest.spec !== JSON.stringify(spec);
    const ready = pagesTest && !pagesStale && spec ? readiness(pagesTest.results, { spec, output }, samples) : null;

    const results = new Map((test?.result.fields ?? []).map(f => [f.fieldId, f]));
    const stale = !!test && test.spec !== JSON.stringify(spec);

    const save = async () => {
        if (!recipe || !base || !spec) return;
        setSaving(true);
        setError(null);
        try {
            await saveSpecVersion(recipe, base, spec, output, note, repair ? 'repaired' : 'edited');
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
        <div key={field.id} data-testid="pro-field"><Disclosure defaultOpen={repairing.has(field.name)} className={repairing.has(field.name) ? 'border-danger!' : undefined}
            summary={<span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold">{field.name || 'unnamed'}</span><Chip>{field.type}</Chip>{field.required && <Chip tone="warning">required</Chip>}<ResultChip result={results.get(field.id)} /></span>}
            meta={<Text size="caption" tone="faint">{field.ways.length} way{field.ways.length === 1 ? '' : 's'}{field.ops.length ? ` · ${field.ops.length} cleanup` : ''}</Text>}>
            <div className="flex flex-col gap-3 pt-2">
                {results.get(field.id) && (
                    <div className="flex flex-col gap-0.5 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-field-result">
                        <Text size="caption" tone="muted">On the tested page ({results.get(field.id)!.status}{results.get(field.id)!.way !== undefined ? ` · way ${results.get(field.id)!.way! + 1}` : ''})</Text>
                        <Text size="caption" mono className="break-all" lines={3}>{preview(results.get(field.id)!.value)}</Text>
                    </div>
                )}
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
                {/* What most edits don't need, folded: how it is found, and its cleanup. */}
                <div data-testid="pro-field-advanced"><Disclosure variant="plain" defaultOpen={repairing.has(field.name)}
                    summary={`Ways and cleanup · ${field.ways.length} way${field.ways.length === 1 ? '' : 's'}${field.ops.length ? `, ${field.ops.length} cleanup step${field.ops.length === 1 ? '' : 's'}` : ''}`}>
                    <div className="flex flex-col gap-3 pt-2">
                        <Ways ways={field.ways}
                            onMove={(w, d) => setSpec(edits.moveWay(spec, field.id, w, d))}
                            onRemove={w => setSpec(edits.removeWay(spec, field.id, w))}
                            onAdd={s => setSpec(edits.addSelector(spec, field.id, s))}
                            options={(way, w) => <WayEditor way={way} onChange={next => setSpec(edits.setWay(spec, field.id, w, next))} />} />
                        <MarkupSource onAdd={way => setSpec(edits.addWayFirst(spec, field.id, way))} />
                        <Cleanup ops={field.ops} onChange={ops => setSpec(edits.setOps(spec, field.id, ops))} />
                    </div>
                </Disclosure></div>
            </div>
        </Disclosure></div>
    );

    return (
        <div className="flex h-full flex-col">
            {header}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
                {repair && (
                    <div data-testid="pro-repair"><Notice tone="danger" title={`Repairing: ${repair.fields.map(f => f.name).join(', ')}`}>
                        <span className="flex flex-col gap-1">
                            {repair.fields.map(f => (
                                <span key={f.name}>{f.name}: {Math.round(f.baseline * 100)}% when tested, {Math.round(f.now * 100)}% on the live crawl.</span>
                            ))}
                            {repair.fields.flatMap(f => f.failingPages).slice(0, 1).map(url => (
                                <span key={url}><Button size="sm" variant="secondary" icon={<ExternalLink />} onClick={() => openFailing(url)}>Open a failing page</Button></span>
                            ))}
                            <span>Fix the fields (re-pick them on the page if needed), test, then save and submit.</span>
                        </span>
                    </Notice></div>
                )}
                {test && (test.result.error
                    ? <Notice tone="danger" title="The test could not run on this page">{test.result.error}</Notice>
                    : test.result.rule
                    ? <div data-testid="pro-test-summary"><Notice tone="warning" title={`Page rule "${test.result.rule.name}" holds: ${STATUS_LABELS[test.result.rule.status]}`}>
                        No field was read. {stale ? 'You changed the recipe since this test.' : ''}
                        {samples.find(x => x.url === test.result.url)?.expectRule !== test.result.rule.name && (
                            <div className="pt-1.5"><Button size="sm" variant="secondary" onClick={() => void (async () => {
                                if (!samples.some(x => x.url === test.result.url)) await addSample(test.result.url);
                                await expectSample(test.result.url, test.result.rule!.name);
                            })()}>Keep as a sample that should hit "{test.result.rule.name}"</Button></div>
                        )}
                    </Notice></div>
                    : <div data-testid="pro-test-summary"><Notice tone={passed([test.result]) && !test.result.mismatch ? 'success' : 'warning'}
                        title={`On ${new URL(test.result.url).host}: ${summarize(test.result).filled} of ${summarize(test.result).total} fields found`}>
                        {test.result.setup ? (test.result.setup.ran ? `Session set up first (${test.result.setup.steps.length} steps). ` : 'Session already set up. ') : ''}
                        {summarize(test.result).total - summarize(test.result).ok ? `${summarize(test.result).total - summarize(test.result).ok} with a problem. ` : ''}
                        {test.result.mismatch ? `Another product: the URL names ${test.result.mismatch.expected}, the page has ${test.result.mismatch.found}. ` : ''}
                        {stale ? 'You changed the recipe since this test.' : ''}
                    </Notice></div>)}
                {test?.result.options && (
                    <div className="flex flex-col gap-1 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-test-options">
                        <Text size="caption" tone="muted">One row per item of "{test.result.options[0]?.step}"</Text>
                        {test.result.options.map(o => (
                            <Text key={o.label} size="caption" mono className="break-all" data-testid="pro-test-option">
                                {o.label}: {o.fields.map(f => `${f.name} = ${preview(f.value)}`).join('; ') || '—'}
                            </Text>
                        ))}
                    </div>
                )}
                <div data-testid="pro-samples"><Disclosure icon={<Layers />} defaultOpen
                    summary={`Sample pages (${samples.length})`}
                    meta={ready && <Chip tone={ready.ready ? 'success' : 'warning'}>{ready.ready ? 'ready' : 'not ready'}</Chip>}>
                    <div className="flex flex-col gap-2 pt-2">
                        {samples.map((x, i) => (
                            <div key={x.url} className="flex items-center gap-1.5" data-testid="pro-sample">
                                <Text size="caption" mono className="min-w-0 flex-1 truncate" title={x.url}>{i + 1}. {shortUrl(x.url)}</Text>
                                {(spec.rules?.length || x.expectRule) ? (
                                    <Select<string> size="sm" aria-label={`Sample ${i + 1} should be`} value={x.expectRule ?? ''}
                                        options={[{ value: '', label: 'A page to read' },
                                            ...(spec.rules ?? []).map(r => ({ value: r.name, label: `Hits "${r.name}"` })),
                                            ...(x.expectRule && !spec.rules?.some(r => r.name === x.expectRule) ? [{ value: x.expectRule, label: `Hits "${x.expectRule}" (gone)` }] : [])]}
                                        onChange={rule => void expectSample(x.url, rule || undefined)} />
                                ) : null}
                                <IconButton size="sm" label={`Remove sample ${i + 1}`} onClick={() => removeSample(x.url)}><X /></IconButton>
                            </div>
                        ))}
                        {spec.rules?.length ? <Text size="caption" tone="faint">An error page kept to test a page rule passes when that rule holds; it needs 3 other pages to read.</Text> : null}
                        <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => addSample(page.url)}
                                disabled={!page.web || samples.some(x => x.url === page.url)}>Add this page</Button>
                            <Button size="sm" variant="secondary" icon={<FlaskConical />} loading={!!progress}
                                disabled={samples.length === 0 || blockers.length > 0 || !!progress} onClick={runPagesTest}>
                                Test on {Math.min(samples.length, TEST_PAGES)} page{Math.min(samples.length, TEST_PAGES) === 1 ? '' : 's'}
                            </Button>
                        </div>
                        {progress && <Text size="caption" tone="muted">Testing page {progress.done + 1} of {progress.total}…</Text>}
                        {pagesStale && <Text size="caption" tone="warning">You changed the recipe since this test.</Text>}
                        {pagesTest && <TestGrid results={pagesTest.results} expect={expectations(samples)}
                            fields={spec.steps.flatMap(st => st.kind === 'field' ? [{ id: st.field.id, name: st.field.name }] : [])} />}
                        {ready && (ready.ready
                            ? <Text size="caption" tone="success" data-testid="pro-readiness">Ready to submit{changes.length ? ' once saved' : ''}.</Text>
                            : <Text size="caption" tone="warning" data-testid="pro-readiness">Not ready: {ready.reasons.join(' ')}</Text>)}
                    </div>
                </Disclosure></div>
                <Disclosure icon={<FileCheck />} summary="Output contract"
                    meta={output.contract ? <Chip tone="info">{output.contract.label}</Chip> : <Text size="caption" tone="faint">none</Text>}>
                    <div className="pt-2">
                        <ContractPanel output={output} onChange={setOutput}
                            fields={spec.steps.flatMap(st => st.kind === 'field' ? [st.field] : [])}
                            results={pagesTest && !pagesStale ? pagesTest.results : undefined} />
                    </div>
                </Disclosure>
                <Disclosure icon={<ShieldAlert />} summary={`Page rules (${spec.rules?.length ?? 0})`}>
                    <PageRules rules={spec.rules ?? []} onChange={rules => setSpec(edits.setRules(spec, rules))} />
                </Disclosure>
                <Disclosure icon={<Fingerprint />} summary="Identity check"
                    meta={spec.identity ? <Chip tone="info">{spec.identity.field}</Chip> : <Text size="caption" tone="faint">none</Text>}>
                    <IdentityCheck identity={spec.identity} fields={spec.steps.flatMap(st => st.kind === 'field' ? [st.field.name] : [])}
                        onChange={identity => setSpec(edits.setIdentity(spec, identity))} />
                </Disclosure>
                <BeforeReading spec={spec} onChange={setSpec} context={context} onContext={changeContext} picker={picker} />
                <Text size="caption" tone="faint">Steps run in this order: a step (a click, a choice, typing), then the fields it reveals.</Text>
                {spec.steps.map((s, i) => s.kind === 'field' ? fieldCard(s.field, i) : <PageAction key={s.click.id} spec={spec} click={s.click} index={i} onChange={setSpec} picker={picker} />)}
                <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setSpec(edits.addAction(spec, newStep(`Step ${spec.steps.filter(x => x.kind === 'click').length + 1}`)))}>Add a step</Button></div>
            </div>
            <div className="flex flex-col gap-2 border-t border-line bg-bg p-4">
                {blockers.length > 0 && <Notice tone="warning">{blockers.join(' ')}</Notice>}
                {error && <Notice tone="danger">{error}</Notice>}
                <Text size="caption" tone="muted" data-testid="pro-editor-changes">{changes.length === 0 ? 'No changes yet.' : `${changes.length} change${changes.length === 1 ? '' : 's'}: ${changes.map(c => c.subject).join(', ')}`}</Text>
                <TextArea label="What changed" rows={2} value={note} onChange={e => setNote(e.target.value)} />
                <div className="flex gap-2">
                    <Button variant="secondary" icon={<FlaskConical />} loading={testing} disabled={!page.web || blockers.length > 0} onClick={runTest}
                        title={page.host ? `Runs on ${page.host}` : 'Open a web page to test on'}>Test on this page</Button>
                    <Button variant="primary" className="flex-1" icon={<Save />} loading={saving} disabled={changes.length === 0 || blockers.length > 0} onClick={save}>Save version {base.version + 1}</Button>
                </div>
            </div>
        </div>
    );
}
