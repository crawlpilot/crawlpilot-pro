import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Chip, Dialog, Notice, Progress, Stack, Text, TextArea, ToggleChip } from '../../ui';
import { parseSchemaInput, SCHEMA_PRESETS } from '../../../shared/ai/schemaIntake';
import { modelStatus, type ModelStatus } from '../../services/ai/modelHost';
import { runPageExtract, ExtractStopped, type ExtractOutcome, type ExtractedValue } from '../../services/ai/extractRun';
import { STATUS } from '../../pages/AiExtractPage';

interface Props {
    open: boolean;
    onClose: () => void;
    /** Adds Page Extractor elements built from the verified fields. */
    onAddElements: (elements: any[]) => void;
}

const DRAFT_KEY = 'crawlpilot.aiSchema.draft';

/** A field the Page Extractor can rerun with no model: found on the page, with a selector. */
const usable = (v: ExtractedValue | undefined) => Boolean(v?.selectors?.length) && (v!.status === 'structured' || v!.status === 'verified' || v!.status === 'relocated');

export default function AiSchemaDialog({ open, onClose, onAddElements }: Props) {
    const [text, setText] = useState(() => {
        try { return localStorage.getItem(DRAFT_KEY) || SCHEMA_PRESETS.product.text; } catch { return SCHEMA_PRESETS.product.text; }
    });
    const [model, setModel] = useState<ModelStatus | null>(null);
    const availability = model?.availability ?? null;
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [download, setDownload] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ExtractOutcome | null>(null);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const abortRef = useRef<AbortController | null>(null);

    const intake = useMemo(() => parseSchemaInput(text), [text]);

    useEffect(() => {
        if (open) modelStatus().then(setModel);
    }, [open]);

    useEffect(() => {
        try { localStorage.setItem(DRAFT_KEY, text); } catch { /* storage blocked */ }
    }, [text]);

    const run = async () => {
        setError(null);
        setResult(null);
        setRunning(true);
        setDownload(null);
        abortRef.current = new AbortController();
        try {
            const res = await runPageExtract({ fields: intake.fields, lists: [] }, {
                compileSingle: true,
                onStatus: setStatus,
                onDownloadProgress: setDownload,
                signal: abortRef.current.signal,
            });
            setResult(res);
            setChosen(new Set(intake.fields.filter(f => usable(res.single[f.name])).map(f => f.name)));
        } catch (e: any) {
            if (!(e instanceof ExtractStopped)) setError(e?.message || String(e));
        } finally {
            setRunning(false);
            setStatus('');
        }
    };

    const add = () => {
        if (!result) return;
        const now = Date.now();
        const elements = intake.fields
            .filter(f => chosen.has(f.name) && usable(result.single[f.name]))
            .map((f, i) => {
                const v = result.single[f.name];
                return { id: `${now}_${i}`, name: f.name, selectors: v.selectors!, action: 'extract', type: v.elementType ?? 'text', value: v.text, source: 'ai' };
            });
        onAddElements(elements);
        onClose();
    };

    const unavailable = availability === 'unavailable';

    return (
        <Dialog open={open} onClose={onClose} persistent={running} size="lg" title="Fill fields from a schema (on-device AI)"
            description="Describe the fields you want. Chrome's built-in model reads this page once and points at each value; every value is checked against the page and turned into a selector, so your bulk runs need no AI and nothing leaves your browser."
            actions={running ? (
                <Button onClick={() => abortRef.current?.abort()}>Stop</Button>
            ) : (
                <>
                    <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancel</Button>
                    <Button variant={result ? 'secondary' : 'primary'} onClick={run} disabled={!!intake.error || intake.fields.length === 0}>
                        {result ? 'Run again' : 'Find fields'}
                    </Button>
                    {result && <Button variant="primary" onClick={add} disabled={chosen.size === 0}>Add {chosen.size} field{chosen.size !== 1 ? 's' : ''}</Button>}
                </>
            )}>
            <Stack gap={3}>
                {unavailable && (
                    <Notice tone="info">
                        Chrome's built-in AI isn't available here: only fields the page publishes as structured data can be found. You can still pick each field with “Select Element”.
                        {model?.reason && <Text size="caption" tone="muted" className="mt-1">{model.reason}</Text>}
                    </Notice>
                )}
                {availability === 'downloadable' && <Notice tone="info">The model downloads once (about 2 GB) the first time you run this.</Notice>}

                <div className="flex flex-wrap gap-1.5">
                    {Object.entries(SCHEMA_PRESETS).map(([k, p]) => (
                        <ToggleChip key={k} selected={text === p.text} onClick={() => setText(p.text)}>{p.label}</ToggleChip>
                    ))}
                </div>
                <TextArea mono rows={7} value={text} onChange={e => setText(e.target.value)} disabled={running}
                    placeholder={'One field per line, e.g.\nprice: current selling price\n\nor paste a JSON Schema / an example JSON object'}
                    hint={intake.error ? undefined : `${intake.fields.length} field${intake.fields.length !== 1 ? 's' : ''} (${intake.source === 'json-schema' ? 'from JSON Schema' : intake.source === 'example' ? 'from example' : 'from lines'})${intake.lists.length ? `; lists (${intake.lists.map(l => l.name).join(', ')}) are filled in AI Extract, not here` : ''}`}
                    error={intake.error} />

                {running && (
                    <Stack gap={1}>
                        <Progress value={download !== null && download < 1 ? download * 100 : undefined} label="Finding fields" />
                        <Text size="caption" tone="muted">{download !== null && download < 1 ? `Downloading model… ${Math.round(download * 100)}%` : status}</Text>
                    </Stack>
                )}
                {error && <Notice tone="warning">{error}</Notice>}

                {result && (
                    <Stack gap={1.5}>
                        {result.warnings.map((w, i) => <Text key={i} size="caption" tone="muted">{w}</Text>)}
                        {intake.fields.map(f => {
                            const v = result.single[f.name];
                            const ok = usable(v);
                            return (
                                <div key={f.name} className={`flex items-start gap-2.5 rounded-field border border-line p-2.5 ${ok ? '' : 'opacity-70'}`}>
                                    <Checkbox disabled={!ok} checked={chosen.has(f.name)} aria-label={f.name}
                                        onChange={on => {
                                            const next = new Set(chosen);
                                            if (on) next.add(f.name); else next.delete(f.name);
                                            setChosen(next);
                                        }} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Text size="small" weight="bold">{f.name}</Text>
                                            {v && <Chip tone={STATUS[v.status].color}>{STATUS[v.status].label}</Chip>}
                                            {v?.grade && ok && (
                                                <Chip tone={v.grade.grade === 'strong' ? 'success' : v.grade.grade === 'fragile' ? 'warning' : 'danger'} title={v.grade.reason}>
                                                    {`${v.grade.grade} selector`}
                                                </Chip>
                                            )}
                                        </div>
                                        <Text size="caption" tone="muted" className="mt-0.5 break-words">
                                            {!v || v.status === 'empty' ? 'Nothing found for this field.'
                                                : v.status === 'needs_model' ? 'Needs the on-device model.'
                                                    : v.status === 'unverified' ? `The model said “${v.text.slice(0, 80)}”, which isn't on the page: dropped.`
                                                        : !v.selectors?.length ? `${v.text.slice(0, 120)} (from the page's data; not shown on the page, so no selector)`
                                                            : v.text.slice(0, 160)}
                                        </Text>
                                    </div>
                                </div>
                            );
                        })}
                    </Stack>
                )}
            </Stack>
        </Dialog>
    );
}
