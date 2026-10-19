import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Copy, Database, Sparkles } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { parseSchemaInput, SCHEMA_PRESETS } from '../../shared/ai/schemaIntake';
import { modelStatus, type ModelStatus } from '../services/ai/modelHost';
import { runPageExtract, ExtractStopped, type ExtractOutcome, type ExtractedValue, type ValueStatus } from '../services/ai/extractRun';
import { outcomeJson, outcomeTables } from '../services/ai/extractTables';
import { db } from '../../shared/db';

const DRAFT_KEY = 'crawlpilot.aiExtract.draft';
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

function Value({ v }: { v: ExtractedValue | undefined }) {
    if (!v) return null;
    const s = STATUS[v.status];
    const text = shown(v);
    return (
        <Tooltip title={`${s.label}${v.source ? ` · ${v.source}` : ''}`} placement="top">
            <Box component="span" sx={{
                borderBottom: 2, borderColor: s.color === 'default' ? 'divider' : `${s.color}.main`,
                textDecoration: v.status === 'unverified' ? 'line-through' : 'none', wordBreak: 'break-word',
                color: text ? 'text.primary' : 'text.disabled',
            }}>
                {text || '—'}
            </Box>
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

    const unavailable = model?.availability === 'unavailable';
    const [whyOpen, setWhyOpen] = useState(false);
    const counts = intake.fields.length + intake.lists.reduce((n, l) => n + l.fields.length, 0);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <ToolHeader title="AI Extract" icon={<Sparkles size={17} />} onBack={onBack}
                subtitle="Describe what you want; AI in Chrome fills it from this page" />

            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                <Stack spacing={1.5}>
                    {unavailable && (
                        <Alert severity="info" variant="outlined"
                            action={model?.reason ? <Button size="small" color="inherit" onClick={() => setWhyOpen(o => !o)}>{whyOpen ? 'Hide' : 'Why?'}</Button> : undefined}>
                            AI isn't available in this Chrome, so CrawlPilot fills only what the page itself publishes.
                            {whyOpen && model?.reason && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>{model.reason}</Typography>}
                        </Alert>
                    )}
                    {model?.availability === 'downloadable' && (
                        <Alert severity="info" variant="outlined">The model downloads once (a few GB) the first time you run this.</Alert>
                    )}

                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {Object.entries(SCHEMA_PRESETS).map(([k, p]) => (
                            <Chip key={k} size="small" label={p.label} onClick={() => setText(p.text)} variant="outlined" disabled={running} />
                        ))}
                    </Stack>
                    <TextField
                        multiline minRows={6} maxRows={14} fullWidth size="small" value={text} disabled={running}
                        onChange={e => setText(e.target.value)}
                        placeholder={'One field per line, e.g.\nprice: current selling price\n\nA list:\nproducts[]:\n  title: product name\n  price: price\n\nor paste a JSON Schema / an example JSON object'}
                        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                    />
                    <Typography variant="caption" color={intake.error ? 'warning.main' : 'text.secondary'}>
                        {intake.error ?? `${counts} field${counts !== 1 ? 's' : ''}${intake.lists.length ? ` · ${intake.lists.length} list${intake.lists.length !== 1 ? 's' : ''}` : ''} (${intake.source === 'json-schema' ? 'JSON Schema' : intake.source === 'example' ? 'example' : 'lines'})`}
                    </Typography>
                    <TextField size="small" fullWidth value={instructions} disabled={running} onChange={e => setInstructions(e.target.value)} placeholder="Optional instructions, e.g. only items in stock" />

                    <Stack direction="row" spacing={1}>
                        {running
                            ? <Button variant="outlined" onClick={() => abortRef.current?.abort()}>Stop</Button>
                            : <Button variant="contained" onClick={run} disabled={!!intake.error} startIcon={<Sparkles size={16} />}>{outcome ? 'Run again' : 'Extract'}</Button>}
                        {outcome && !running && (
                            <>
                                <Button variant="outlined" onClick={save} startIcon={<Database size={16} />} disabled={saved.length > 0}>{saved.length ? 'Saved' : 'Save to Data'}</Button>
                                <Button variant="text" onClick={copyJson} startIcon={<Copy size={16} />}>JSON</Button>
                            </>
                        )}
                    </Stack>

                    {running && (
                        <Box>
                            <LinearProgress variant={download !== null && download < 1 ? 'determinate' : 'indeterminate'} value={(download ?? 0) * 100} />
                            <Typography variant="caption" color="text.secondary">
                                {download !== null && download < 1 ? `Downloading model… ${Math.round(download * 100)}%` : status}
                            </Typography>
                        </Box>
                    )}
                    {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

                    {outcome && (
                        <Stack spacing={1.5}>
                            {outcome.warnings.map((w, i) => <Alert key={i} severity="info" variant="outlined" sx={{ py: 0 }}>{w}</Alert>)}
                            {intake.fields.length > 0 && (
                                <Paper variant="outlined" sx={{ p: 1.25 }}>
                                    <Stack spacing={0.75}>
                                        {intake.fields.map(f => (
                                            <Box key={f.name} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 1, alignItems: 'baseline' }}>
                                                <Typography variant="caption" fontWeight={700} sx={{ wordBreak: 'break-word' }}>{f.name}</Typography>
                                                <Typography variant="body2"><Value v={outcome.single[f.name]} /></Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Paper>
                            )}
                            {intake.lists.map(l => {
                                const items = outcome.lists[l.name] ?? [];
                                return (
                                    <Paper key={l.name} variant="outlined" sx={{ overflow: 'auto' }}>
                                        <Typography variant="subtitle2" sx={{ px: 1.25, pt: 1 }}>{l.name} · {items.length} item{items.length !== 1 ? 's' : ''}</Typography>
                                        <Table size="small">
                                            <TableHead><TableRow>{l.fields.map(f => <TableCell key={f.name} sx={{ fontWeight: 700, fontSize: 11 }}>{f.name}</TableCell>)}</TableRow></TableHead>
                                            <TableBody>
                                                {items.slice(0, ROWS_SHOWN).map((item, i) => (
                                                    <TableRow key={i}>{l.fields.map(f => <TableCell key={f.name} sx={{ fontSize: 12, maxWidth: 220 }}><Value v={item[f.name]} /></TableCell>)}</TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                        {items.length > ROWS_SHOWN && <Typography variant="caption" color="text.secondary" sx={{ p: 1.25, display: 'block' }}>{items.length - ROWS_SHOWN} more in the saved table.</Typography>}
                                    </Paper>
                                );
                            })}
                            <Typography variant="caption" color="text.secondary">
                                Underline colour shows where a value came from: green, the page's data or checked on the page; blue, found elsewhere on the page; red, not on the page (crossed out).
                            </Typography>
                        </Stack>
                    )}
                </Stack>
            </Box>
        </Box>
    );
}
