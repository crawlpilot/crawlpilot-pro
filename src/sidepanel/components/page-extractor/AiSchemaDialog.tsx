import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import { Sparkles } from 'lucide-react';
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
        <Dialog open={open} onClose={running ? undefined : onClose} fullWidth maxWidth="sm">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Sparkles size={18} /> Fill fields from a schema (on-device AI)
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                        Describe the fields you want. Chrome's built-in model reads this page once and points at each value; every value is checked against the page and turned into a selector, so your bulk runs need no AI and nothing leaves your browser.
                    </Typography>
                    {unavailable && (
                        <Alert severity="info" variant="outlined">
                            Chrome's built-in AI isn't available here: only fields the page publishes as structured data can be found. You can still pick each field with “Select Element”.
                            {model?.reason && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>{model.reason}</Typography>}
                        </Alert>
                    )}
                    {availability === 'downloadable' && (
                        <Alert severity="info" variant="outlined">The model downloads once (about 2 GB) the first time you run this.</Alert>
                    )}

                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {Object.entries(SCHEMA_PRESETS).map(([k, p]) => (
                            <Chip key={k} size="small" label={p.label} onClick={() => setText(p.text)} variant="outlined" />
                        ))}
                    </Stack>
                    <TextField
                        multiline minRows={6} maxRows={12} fullWidth size="small"
                        value={text} onChange={e => setText(e.target.value)}
                        placeholder={'One field per line, e.g.\nprice: current selling price\n\nor paste a JSON Schema / an example JSON object'}
                        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                        disabled={running}
                    />
                    <Typography variant="caption" color={intake.error ? 'warning.main' : 'text.secondary'}>
                        {intake.error ?? `${intake.fields.length} field${intake.fields.length !== 1 ? 's' : ''} (${intake.source === 'json-schema' ? 'from JSON Schema' : intake.source === 'example' ? 'from example' : 'from lines'})${intake.lists.length ? `; lists (${intake.lists.map(l => l.name).join(', ')}) are filled in AI Extract, not here` : ''}`}
                    </Typography>

                    {running && (
                        <Box>
                            <LinearProgress variant={download !== null && download < 1 ? 'determinate' : 'indeterminate'} value={(download ?? 0) * 100} />
                            <Typography variant="caption" color="text.secondary">
                                {download !== null && download < 1 ? `Downloading model… ${Math.round(download * 100)}%` : status}
                            </Typography>
                        </Box>
                    )}
                    {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

                    {result && (
                        <Box>
                            {result.warnings.map((w, i) => (
                                <Typography key={i} variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>{w}</Typography>
                            ))}
                            <Stack spacing={0.5}>
                                {intake.fields.map(f => {
                                    const v = result.single[f.name];
                                    const ok = usable(v);
                                    return (
                                        <Box key={f.name} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1, display: 'flex', gap: 1, alignItems: 'flex-start', opacity: ok ? 1 : 0.7 }}>
                                            <Checkbox size="small" sx={{ p: 0.25 }} disabled={!ok} checked={chosen.has(f.name)}
                                                onChange={e => {
                                                    const next = new Set(chosen);
                                                    if (e.target.checked) next.add(f.name); else next.delete(f.name);
                                                    setChosen(next);
                                                }} />
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                                    <Typography variant="caption" fontWeight={700}>{f.name}</Typography>
                                                    {v && <Chip size="small" label={STATUS[v.status].label} color={STATUS[v.status].color} sx={{ height: 18, fontSize: 10 }} />}
                                                    {v?.grade && ok && (
                                                        <Chip size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }}
                                                            color={v.grade.grade === 'strong' ? 'success' : v.grade.grade === 'fragile' ? 'warning' : 'error'}
                                                            label={`${v.grade.grade} selector`} title={v.grade.reason} />
                                                    )}
                                                </Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                                                    {!v || v.status === 'empty' ? 'Nothing found for this field.'
                                                        : v.status === 'needs_model' ? 'Needs the on-device model.'
                                                            : v.status === 'unverified' ? `The model said “${v.text.slice(0, 80)}”, which isn't on the page: dropped.`
                                                                : !v.selectors?.length ? `${v.text.slice(0, 120)} (from the page's data; not shown on the page, so no selector)`
                                                                    : v.text.slice(0, 160)}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Stack>
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                {running ? (
                    <Button onClick={() => abortRef.current?.abort()}>Stop</Button>
                ) : (
                    <>
                        <Button onClick={onClose} sx={{ mr: 'auto' }}>Cancel</Button>
                        <Button onClick={run} disabled={!!intake.error || intake.fields.length === 0} variant={result ? 'outlined' : 'contained'}>
                            {result ? 'Run again' : 'Find fields'}
                        </Button>
                        {result && (
                            <Button variant="contained" onClick={add} disabled={chosen.size === 0}>Add {chosen.size} field{chosen.size !== 1 ? 's' : ''}</Button>
                        )}
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}
