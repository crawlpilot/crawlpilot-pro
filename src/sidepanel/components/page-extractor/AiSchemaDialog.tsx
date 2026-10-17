import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import { Sparkles } from 'lucide-react';
import { parseSchemaInput, SCHEMA_PRESETS } from '../../../shared/ai/schemaIntake';
import { getPromptAvailability, EngineAvailability } from '../../services/ai/promptSession';
import { runSchemaExtraction, SchemaExtractionResult } from '../../services/ai/extractSession';
import type { VerifiedField } from '../../../content/services/ai-view/ReferencedView';

interface Props {
    open: boolean;
    onClose: () => void;
    /** Adds Page Extractor elements built from the verified fields. */
    onAddElements: (elements: any[]) => void;
}

const DRAFT_KEY = 'crawlpilot.aiSchema.draft';

const STATUS: Record<VerifiedField['status'], { label: string; color: 'success' | 'info' | 'warning' | 'default' }> = {
    verified: { label: 'Verified on page', color: 'success' },
    relocated: { label: 'Verified (found elsewhere)', color: 'info' },
    not_on_page: { label: 'Not on page', color: 'warning' },
    empty: { label: 'Not found', color: 'default' },
};

export default function AiSchemaDialog({ open, onClose, onAddElements }: Props) {
    const [text, setText] = useState(() => {
        try { return localStorage.getItem(DRAFT_KEY) || SCHEMA_PRESETS.product.text; } catch { return SCHEMA_PRESETS.product.text; }
    });
    const [availability, setAvailability] = useState<EngineAvailability | null>(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [download, setDownload] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<SchemaExtractionResult | null>(null);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const abortRef = useRef<AbortController | null>(null);

    const intake = useMemo(() => parseSchemaInput(text), [text]);

    useEffect(() => {
        if (open) getPromptAvailability().then(setAvailability);
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
            const res = await runSchemaExtraction(intake.fields, {
                onStatus: setStatus,
                onDownloadProgress: setDownload,
                signal: abortRef.current.signal,
            });
            setResult(res);
            setChosen(new Set(res.fields.filter(f => f.status === 'verified' || f.status === 'relocated').map(f => f.name)));
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setRunning(false);
            setStatus('');
        }
    };

    const add = () => {
        if (!result) return;
        const now = Date.now();
        const elements = result.fields
            .filter(f => chosen.has(f.name) && f.selectors.length > 0)
            .map((f, i) => ({
                id: `${now}_${i}`,
                name: f.name,
                selectors: f.selectors,
                action: 'extract',
                type: f.type,
                value: f.preview ?? f.value,
                source: 'ai',
            }));
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
                            Chrome's built-in AI isn't available here. You can still pick each field with “Select Element”.
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
                        {intake.error ?? `${intake.fields.length} field${intake.fields.length !== 1 ? 's' : ''} (${intake.source === 'json-schema' ? 'from JSON Schema' : intake.source === 'example' ? 'from example' : 'from lines'})`}
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
                            {result.truncated && (
                                <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 0.5 }}>
                                    The page was too long for the model; only the first part was read.
                                </Typography>
                            )}
                            <Stack spacing={0.5}>
                                {result.fields.map(f => {
                                    const usable = f.selectors.length > 0 && (f.status === 'verified' || f.status === 'relocated');
                                    return (
                                        <Box key={f.name} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1, display: 'flex', gap: 1, alignItems: 'flex-start', opacity: usable ? 1 : 0.7 }}>
                                            <Checkbox size="small" sx={{ p: 0.25 }} disabled={!usable} checked={chosen.has(f.name)}
                                                onChange={e => {
                                                    const next = new Set(chosen);
                                                    if (e.target.checked) next.add(f.name); else next.delete(f.name);
                                                    setChosen(next);
                                                }} />
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                                    <Typography variant="caption" fontWeight={700}>{f.name}</Typography>
                                                    <Chip size="small" label={STATUS[f.status].label} color={STATUS[f.status].color} sx={{ height: 18, fontSize: 10 }} />
                                                    {f.grade && usable && (
                                                        <Chip size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }}
                                                            color={f.grade.grade === 'strong' ? 'success' : f.grade.grade === 'fragile' ? 'warning' : 'error'}
                                                            label={`${f.grade.grade} selector`} title={f.grade.reason} />
                                                    )}
                                                </Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
                                                    {f.status === 'not_on_page' ? `Model said “${f.value.slice(0, 80)}”, which isn't on the page: dropped.`
                                                        : f.status === 'empty' ? 'The model found nothing for this field.'
                                                            : (f.preview || f.value).slice(0, 160)}
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
                        <Button onClick={run} disabled={!!intake.error || unavailable} variant={result ? 'outlined' : 'contained'}>
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
