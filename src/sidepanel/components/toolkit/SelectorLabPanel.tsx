import { useEffect, useState, useCallback } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography, Alert, ToggleButton, ToggleButtonGroup, IconButton, Tooltip } from '@mui/material';
import { Crosshair, Play, Copy, Check } from 'lucide-react';
import type { LabEval, LabCandidate, LabPick } from '../../../content/features/lab/SelectorLab';
import { SNIPPET_LABELS, SnippetTarget, toSnippet } from '../../../shared/selectors/snippets';
import { on, sendToActiveTab } from '../../../shared/messages';
import { copyText } from '../../services/clipboard';

const GRADE_COLOR = { strong: 'success', fragile: 'warning', broken: 'error' } as const;
const GRADE_LABEL = { strong: 'Strong', fragile: 'Fragile', broken: 'Broken' } as const;

function GradeChip({ ev }: { ev: LabEval }) {
    return <Chip size="small" color={GRADE_COLOR[ev.grade.grade]} label={GRADE_LABEL[ev.grade.grade]} sx={{ fontWeight: 700 }} />;
}

export default function SelectorLabPanel() {
    const [selector, setSelector] = useState('');
    const [result, setResult] = useState<LabEval | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [pick, setPick] = useState<LabPick | null>(null);
    const [target, setTarget] = useState<SnippetTarget>('playwright');
    const [copied, setCopied] = useState(false);

    const evaluate = useCallback(async (sel: string) => {
        if (!sel.trim()) return;
        setError(null);
        try {
            const res = await sendToActiveTab('LAB_EVAL', { selector: sel.trim() });
            setResult(res.result);
        } catch (e: any) {
            setError(e.message);
        }
    }, []);

    useEffect(() => {
        const off = on('LAB_PICKED', picked => {
            setPicking(false);
            if (picked) setPick(picked);
        });
        return () => {
            off();
            sendToActiveTab('LAB_CLEAR').catch(() => { /* tab gone */ });
        };
    }, []);

    const startPick = async () => {
        setError(null);
        setPick(null);
        try {
            await sendToActiveTab('LAB_PICK_START');
            setPicking(true);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const useCandidate = (c: LabCandidate) => {
        setSelector(c.selector);
        evaluate(c.selector);
    };

    const snippet = result && result.count > 0 ? toSnippet(target, result.selector, result.count > 1) : '';

    return (
        <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
                Test a CSS or XPath selector on this page, see how likely it is to survive site changes, and copy it as code.
            </Typography>

            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                    size="small" fullWidth placeholder=".product-card .price  or  //h1"
                    value={selector}
                    onChange={e => setSelector(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') evaluate(selector); }}
                    inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                />
                <Button variant="contained" onClick={() => evaluate(selector)} sx={{ minWidth: 0, px: 1.5 }}><Play size={16} /></Button>
            </Box>
            <Button variant="outlined" onClick={startPick} disabled={picking} startIcon={<Crosshair size={16} />}>
                {picking ? 'Click an element on the page (Esc to cancel)…' : 'Pick an element'}
            </Button>
            {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

            {result && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                        <GradeChip ev={result} />
                        <Typography variant="caption" fontWeight={700}>{result.count} match{result.count !== 1 ? 'es' : ''}</Typography>
                        <Typography variant="caption" color="text.secondary">· {result.kind.toUpperCase()} · {result.grade.family}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block">{result.grade.reason}</Typography>
                    {result.samples.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                            {result.samples.map((s, i) => (
                                <Typography key={i} variant="caption" display="block" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {i + 1}. {s}
                                </Typography>
                            ))}
                        </Box>
                    )}
                    {snippet && (
                        <Box sx={{ mt: 1.5 }}>
                            <ToggleButtonGroup size="small" exclusive value={target} onChange={(_, v) => v && setTarget(v)} sx={{ flexWrap: 'wrap', mb: 0.75 }}>
                                {(Object.keys(SNIPPET_LABELS) as SnippetTarget[]).map(k => (
                                    <ToggleButton key={k} value={k} sx={{ py: 0.25, px: 0.75, fontSize: 10, textTransform: 'none' }}>{SNIPPET_LABELS[k]}</ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                            <Box sx={{ position: 'relative' }}>
                                <Box component="pre" sx={{ m: 0, p: 1, pr: 4, fontSize: 11, bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{snippet}</Box>
                                <Tooltip title={copied ? 'Copied' : 'Copy'}>
                                    <IconButton size="small" sx={{ position: 'absolute', top: 2, right: 2 }}
                                        onClick={async () => { await copyText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                                        {copied ? <Check size={14} /> : <Copy size={14} />}
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Box>
                    )}
                </Box>
            )}

            {pick && (
                <Box>
                    <Typography variant="overline" color="text.secondary" fontWeight={700}>
                        Ways to find &lt;{pick.tag}&gt; “{pick.text.slice(0, 40)}”
                    </Typography>
                    {pick.candidates.length === 0 && <Typography variant="caption" color="text.secondary">No selector found for this element.</Typography>}
                    <Stack spacing={0.5}>
                        {pick.candidates.map(c => (
                            <Box key={c.selector} onClick={() => useCandidate(c)}
                                sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                                    <GradeChip ev={c} />
                                    <Typography variant="caption" color="text.secondary">
                                        {c.list ? `all similar · ${c.count}` : c.count === 1 ? 'unique' : `${c.count} matches`} · {c.grade.family}
                                    </Typography>
                                </Box>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>{c.selector}</Typography>
                                <Typography variant="caption" color="text.secondary">{c.grade.reason}</Typography>
                            </Box>
                        ))}
                    </Stack>
                </Box>
            )}
        </Stack>
    );
}
