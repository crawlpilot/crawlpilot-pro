import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Notice, Progress, Stack, Text, TextArea, TextField, ToggleChip, Tooltip, cx, type ChipTone } from '../ui';
import { Copy, Database, Download, Sparkles } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { parseSchemaInput, SCHEMA_PRESETS } from '../../shared/ai/schemaIntake';
import { modelStatus, type ModelStatus } from '../services/ai/modelHost';
import { runPageExtract, ExtractStopped, type ExtractOutcome, type ExtractedValue, type ValueStatus } from '../services/ai/extractRun';
import { outcomeDocument, outcomeJson, outcomeTables } from '../services/ai/extractTables';
import { downloadJson } from '../services/download';
import { slug } from '../../shared/utils/text';
import { revealSummary } from '../../shared/types/reveal';
import { db } from '../../shared/db';
import { EXTRACT_DRAFT_KEY } from '../services/ai/extractDraft';

const DRAFT_KEY = EXTRACT_DRAFT_KEY;
const ROWS_SHOWN = 50;

export const STATUS: Record<ValueStatus, { label: string; color: ChipTone }> = {
    structured: { label: 'From page data', color: 'success' },
    verified: { label: 'Verified on page', color: 'success' },
    relocated: { label: 'Found elsewhere on page', color: 'info' },
    unverified: { label: 'Not on page', color: 'danger' },
    invalid: { label: 'Wrong type', color: 'warning' },
    empty: { label: 'Not found', color: 'neutral' },
    needs_model: { label: 'Needs on-device AI', color: 'neutral' },
};

function shown(v: ExtractedValue | undefined): string {
    if (!v || v.status === 'empty' || v.status === 'needs_model') return '';
    return typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
}

const UNDERLINE: Record<ChipTone, string> = {
    success: 'border-success', info: 'border-info', danger: 'border-danger', warning: 'border-warning',
    neutral: 'border-line', brand: 'border-brand', outline: 'border-line',
};

function Value({ v }: { v: ExtractedValue | undefined }) {
    if (!v) return null;
    const s = STATUS[v.status];
    const text = shown(v);
    return (
        <Tooltip title={`${s.label}${v.source ? ` · ${v.source}` : ''}`}>
            <span className={cx('border-b-2 break-words', UNDERLINE[s.color], v.status === 'unverified' && 'line-through', text ? 'text-ink' : 'text-ink-3')}>
                {text || '—'}
            </span>
        </Tooltip>
    );
}

export default function AiExtractPage({ onBack }: { onBack: () => void }) {
    const [text, setText] = useState(() => {
        try { return localStorage.getItem(DRAFT_KEY) || SCHEMA_PRESETS.product.text; } catch { return SCHEMA_PRESETS.product.text; }
    });
    const [instructions, setInstructions] = useState('');
    const [model, setModel] = useState<ModelStatus | null>(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [download, setDownload] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<ExtractOutcome | null>(null);
    const [saved, setSaved] = useState<number[]>([]);
    const abortRef = useRef<AbortController | null>(null);
    const intake = useMemo(() => parseSchemaInput(text), [text]);

    useEffect(() => { modelStatus().then(setModel); }, []);
    useEffect(() => { try { localStorage.setItem(DRAFT_KEY, text); } catch { /* storage blocked */ } }, [text]);

    const run = async () => {
        setError(null);
        setOutcome(null);
        setSaved([]);
        setRunning(true);
        setDownload(null);
        abortRef.current = new AbortController();
        try {
            setOutcome(await runPageExtract(intake, {
                instructions, onStatus: setStatus, onDownloadProgress: setDownload, signal: abortRef.current.signal,
            }));
        } catch (e) {
            if (!(e instanceof ExtractStopped)) setError((e as Error)?.message || String(e));
        } finally {
            setRunning(false);
            setStatus('');
            modelStatus().then(setModel);
        }
    };

    const save = async () => {
        if (!outcome) return;
        const ids: number[] = [];
        for (const t of outcomeTables(outcome, intake)) ids.push(await db.tables.save(t.result, { name: t.name }));
        setSaved(ids);
        if (ids[0] !== undefined) chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${ids[0]}`) });
    };

    const copyJson = () => { if (outcome) void navigator.clipboard.writeText(JSON.stringify(outcomeJson(outcome, intake), null, 2)); };
    /** The data in the schema's shape, with sources per value, problems and warnings. */
    const downloadResult = () => { if (outcome) downloadJson(outcomeDocument(outcome, intake), `${slug(outcome.title || 'extract', '-', 'extract')}.json`); };

    const unavailable = model?.availability === 'unavailable';
    const [whyOpen, setWhyOpen] = useState(false);
    const counts = intake.fields.length + intake.lists.reduce((n, l) => n + l.fields.length, 0);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title="AI Extract" icon={<Sparkles size={17} />} onBack={onBack}
                subtitle="Describe what you want; AI in Chrome fills it from this page" />

            <div className="flex-1 overflow-y-auto p-4">
                <Stack gap={3}>
                    {unavailable && (
                        <Notice tone="info"
                            action={model?.reason ? <Button size="sm" variant="ghost" onClick={() => setWhyOpen(o => !o)}>{whyOpen ? 'Hide' : 'Why?'}</Button> : undefined}>
                            AI isn't available in this Chrome, so CrawlPilot fills only what the page itself publishes.
                            {whyOpen && model?.reason && <Text size="caption" tone="muted" className="mt-1">{model.reason}</Text>}
                        </Notice>
                    )}
                    {model?.availability === 'downloadable' && <Notice tone="info">The model downloads once (a few GB) the first time you run this.</Notice>}

                    <div className="flex flex-wrap gap-1.5">
                        {Object.entries(SCHEMA_PRESETS).map(([k, p]) => (
                            <ToggleChip key={k} selected={text === p.text} onClick={() => setText(p.text)} disabled={running}>{p.label}</ToggleChip>
                        ))}
                    </div>
                    <TextArea mono rows={8} value={text} disabled={running} onChange={e => setText(e.target.value)}
                        placeholder={'One field per line, e.g.\nprice: current selling price\n\nA list:\nproducts[]:\n  title: product name\n  price: price\n\nor paste a JSON Schema / an example JSON object'}
                        error={intake.error}
                        hint={`${counts} field${counts !== 1 ? 's' : ''}${intake.lists.length ? ` · ${intake.lists.length} list${intake.lists.length !== 1 ? 's' : ''}` : ''} (${intake.source === 'json-schema' ? 'JSON Schema' : intake.source === 'example' ? 'example' : 'lines'})`} />
                    {!!intake.problems?.length && (
                        <Notice tone="warning" title="Read in a simpler way">
                            <ul className="m-0 list-disc pl-4">{intake.problems.map(p => <li key={p}>{p}</li>)}</ul>
                        </Notice>
                    )}
                    <TextField size="sm" value={instructions} disabled={running} onChange={e => setInstructions(e.target.value)} placeholder="Optional instructions, e.g. only items in stock" />

                    <div className="flex flex-wrap gap-1.5">
                        {running
                            ? <Button onClick={() => abortRef.current?.abort()}>Stop</Button>
                            : <Button variant="primary" onClick={run} disabled={!!intake.error} icon={<Sparkles />}>{outcome ? 'Run again' : 'Extract'}</Button>}
                        {outcome && !running && (
                            <>
                                <Button onClick={save} icon={<Database />} disabled={saved.length > 0}>{saved.length ? 'Saved' : 'Save to Data'}</Button>
                                <Button variant="ghost" onClick={copyJson} icon={<Copy />}>Copy JSON</Button>
                                <Button variant="ghost" onClick={downloadResult} icon={<Download />}>JSON with sources</Button>
                            </>
                        )}
                    </div>

                    {running && (
                        <Stack gap={1}>
                            <Progress value={download !== null && download < 1 ? download * 100 : undefined} label="Extracting" />
                            <Text size="caption" tone="muted">{download !== null && download < 1 ? `Downloading model… ${Math.round(download * 100)}%` : status}</Text>
                        </Stack>
                    )}
                    {error && <Notice tone="warning">{error}</Notice>}

                    {outcome && (
                        <Stack gap={3}>
                            {revealSummary(outcome.revealed) && (
                                <Text size="caption" tone="muted">Opened before reading: {revealSummary(outcome.revealed)}</Text>
                            )}
                            {outcome.warnings.map((w, i) => <Notice key={i} tone="info">{w}</Notice>)}
                            {intake.fields.length > 0 && (
                                <Card pad="sm">
                                    <Stack gap={1.5}>
                                        {intake.fields.map(f => (
                                            <div key={f.name} className="grid grid-cols-[110px_1fr] items-baseline gap-2">
                                                <Text size="caption" weight="bold" className="break-words">{f.label || f.name}</Text>
                                                <Text size="small"><Value v={outcome.single[f.name]} /></Text>
                                            </div>
                                        ))}
                                    </Stack>
                                </Card>
                            )}
                            {intake.lists.map(l => {
                                const items = outcome.lists[l.name] ?? [];
                                return (
                                    <Card key={l.name} pad="none" className="overflow-auto">
                                        <Text size="small" weight="semibold" className="px-3 pt-2.5 pb-1.5">{l.name} · {items.length} item{items.length !== 1 ? 's' : ''}</Text>
                                        <table className="w-full border-collapse text-caption">
                                            <thead>
                                                <tr>{l.fields.map(f => <th key={f.name} className="border-b border-line bg-surface-2 px-3 py-1.5 text-left font-bold text-ink-2">{f.label || f.name}</th>)}</tr>
                                            </thead>
                                            <tbody>
                                                {items.slice(0, ROWS_SHOWN).map((item, i) => (
                                                    <tr key={i}>{l.fields.map(f => <td key={f.name} className="max-w-[220px] border-b border-line px-3 py-1.5 text-small"><Value v={item[f.name]} /></td>)}</tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {items.length > ROWS_SHOWN && <Text size="caption" tone="muted" className="p-3">{items.length - ROWS_SHOWN} more in the saved table.</Text>}
                                    </Card>
                                );
                            })}
                            <Text size="caption" tone="muted">
                                Underline colour shows where a value came from: green, the page's data or checked on the page; blue, found elsewhere on the page; red, not on the page (crossed out).
                            </Text>
                        </Stack>
                    )}
                </Stack>
            </div>
        </div>
    );
}
