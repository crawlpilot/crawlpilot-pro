import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Crosshair, Play, X, Info, Sparkles, Code2, Database, MousePointerClick } from 'lucide-react';
import type { LabEval, LabCandidate, LabChainEntry, LabPick } from '../../../content/features/lab/SelectorLab';
import { SNIPPET_LABELS, SnippetTarget, toSnippet } from '../../../shared/selectors/snippets';
import { on } from '../../../shared/messages';
import { useToolkit } from './context';
import { CodeBlock, CopyButton, DetailSection, GroupLabel, ToolIntro } from './ui';

const GRADE_COLOR = { strong: 'success', fragile: 'warning', broken: 'error' } as const;
const GRADE_LABEL = { strong: 'Strong', fragile: 'Fragile', broken: 'Broken' } as const;
const GRADE_HELP = {
    strong: 'Built on something the site is unlikely to change (an id, a test id, a stable attribute).',
    fragile: 'Depends on position, layout classes or text, which often change when the site is updated.',
    broken: 'Finds nothing on this page, or is not a valid selector.',
} as const;
const EXAMPLES = ['h1', 'a[href]', 'img', '[data-testid]', '//h2'];
const LIVE_DELAY_MS = 450;
const CANDIDATES_SHOWN = 3;

function GradeChip({ ev }: { ev: LabEval }) {
    const g = ev.grade.grade;
    return (
        <Tooltip title={GRADE_HELP[g]} arrow>
            <Chip size="small" color={GRADE_COLOR[g]} label={GRADE_LABEL[g]} sx={{ fontWeight: 700, height: 20, fontSize: '0.66rem' }} />
        </Tooltip>
    );
}

const isXPath = (s: string) => /^\(?\.?\//.test(s.trim());

/** A stored chain in order: family, grade, matches, and the entry a run would use on this page. */
function StoredChain({ title, entries, onUse }: { title: string; entries: LabChainEntry[]; onUse?: (selector: string) => void }) {
    const winner = entries.findIndex(e => e.wins);
    return (
        <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>{title}</Typography>
            {winner > 0 && (
                <Typography variant="caption" color="warning.main" display="block" mb={0.5}>
                    The first {winner === 1 ? 'entry no longer works' : `${winner} entries no longer work`} here: a run would use backup #{winner + 1}.
                </Typography>
            )}
            {winner < 0 && entries.length > 0 && <Typography variant="caption" color="error.main" display="block" mb={0.5}>No entry finds it on this page.</Typography>}
            <Stack spacing={0.5}>
                {entries.map((e, i) => (
                    <Box key={e.selector} onClick={onUse ? () => onUse(e.selector) : undefined}
                        sx={{ border: 1, borderColor: e.wins ? 'success.main' : 'divider', borderRadius: '10px', p: 1, cursor: onUse ? 'pointer' : 'default', '&:hover': onUse ? { borderColor: 'primary.main' } : undefined }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>#{i + 1}</Typography>
                            <Chip size="small" color={GRADE_COLOR[e.grade.grade]} label={GRADE_LABEL[e.grade.grade]} sx={{ fontWeight: 700, height: 18, fontSize: '0.62rem' }} />
                            <Typography variant="caption">{e.family} · {e.count} match{e.count !== 1 ? 'es' : ''}</Typography>
                            {e.wins && <Chip size="small" variant="outlined" color="success" label="used now" sx={{ height: 18, fontSize: '0.62rem' }} />}
                        </Box>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', color: 'text.primary' }}>{e.selector}</Typography>
                    </Box>
                ))}
            </Stack>
        </Box>
    );
}

function CandidateCard({ c, best, active, onUse }: { c: LabCandidate; best: boolean; active: boolean; onUse: () => void }) {
    return (
        <Box onClick={onUse}
            sx={{
                border: 1, borderColor: active ? 'primary.main' : best ? 'rgba(16,185,129,0.45)' : 'divider', bgcolor: best ? 'rgba(16,185,129,0.05)' : undefined,
                borderRadius: '10px', p: 1, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' },
            }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4 }}>
                {best && <Chip size="small" icon={<Sparkles size={11} />} label="Recommended" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} />}
                <GradeChip ev={c} />
                <Typography variant="caption" sx={{ flex: 1 }}>
                    {c.list ? `all similar · ${c.count}` : c.count === 1 ? 'unique' : `${c.count} matches`} · {c.grade.family}
                </Typography>
                <CopyButton text={c.selector} label="Copy selector" size={13} />
            </Box>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', color: 'text.primary' }}>{c.selector}</Typography>
            <Typography variant="caption" sx={{ fontSize: '0.64rem' }}>{c.grade.reason}</Typography>
        </Box>
    );
}

export default function SelectorLabPanel() {
    const { send, page } = useToolkit();
    const [selector, setSelector] = useState('');
    const [result, setResult] = useState<LabEval | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [pick, setPick] = useState<LabPick | null>(null);
    const [target, setTarget] = useState<SnippetTarget>('playwright');
    const [showAll, setShowAll] = useState(false);
    const typed = useRef(false);

    const evaluate = useCallback(async (sel: string) => {
        if (!sel.trim()) return;
        setError(null);
        try {
            const res = await send('LAB_EVAL', { selector: sel.trim() });
            setResult(res.result);
        } catch (e: any) {
            setError(e.message);
        }
    }, [send]);

    // Test as you type: a moment after the last keystroke, highlight what the selector matches.
    useEffect(() => {
        if (!typed.current || selector.trim().length < 2) return;
        const t = setTimeout(() => evaluate(selector), LIVE_DELAY_MS);
        return () => clearTimeout(t);
    }, [selector, evaluate]);

    useEffect(() => {
        const off = on('LAB_PICKED', picked => {
            setPicking(false);
            if (!picked) return;
            setPick(picked);
            setShowAll(false);
            const best = picked.candidates[0];
            if (best) { typed.current = false; setSelector(best.selector); void evaluate(best.selector); }
        });
        return () => {
            off();
            send('LAB_CLEAR').catch(() => { /* tab gone */ });
        };
    }, [evaluate, send]);

    const startPick = async () => {
        setError(null);
        try {
            await send('LAB_PICK_START');
            setPicking(true);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const use = (sel: string) => {
        typed.current = false;
        setSelector(sel);
        void evaluate(sel);
    };

    const clear = () => {
        typed.current = false;
        setSelector('');
        setResult(null);
        setPick(null);
        send('LAB_CLEAR').catch(() => undefined);
    };

    const snippet = result && result.count > 0 ? toSnippet(target, result.selector, result.count > 1) : '';
    const candidates = pick ? (showAll ? pick.candidates : pick.candidates.slice(0, CANDIDATES_SHOWN)) : [];

    return (
        <Stack spacing={1.5}>
            {!result && !pick && (
                <ToolIntro icon={<Crosshair size={18} />} title="Find a selector that won't break"
                    text="Click any element on the page to get the most robust ways to find it, or type a CSS or XPath selector to test it live."
                    points={['Matches are highlighted on the page as you type', 'Each selector is graded on how likely it survives site updates', 'Copy it as Playwright, Puppeteer, Selenium, Scrapy… code']} />
            )}

            <Button variant="contained" color="warning" onClick={picking ? undefined : startPick} disabled={!page.web}
                startIcon={picking ? <MousePointerClick size={16} /> : <Crosshair size={16} />}
                sx={{ color: '#1a1205', fontWeight: 700, ...(picking ? { animation: 'pulse 1.6s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.7 } } } : {}) }}>
                {picking ? 'Now click an element on the page (Esc cancels)' : 'Pick an element on the page'}
            </Button>

            <Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                        size="small" fullWidth placeholder="or type a selector: .price, //h1"
                        value={selector}
                        onChange={e => { typed.current = true; setSelector(e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') evaluate(selector); }}
                        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 }, 'aria-label': 'Selector' }}
                        InputProps={{
                            endAdornment: selector ? (
                                <InputAdornment position="end" sx={{ gap: 0.5 }}>
                                    <Chip size="small" label={isXPath(selector) ? 'XPath' : 'CSS'} sx={{ height: 18, fontSize: '0.6rem' }} />
                                    <IconButton size="small" onClick={clear} aria-label="Clear"><X size={13} /></IconButton>
                                </InputAdornment>
                            ) : undefined,
                        }}
                    />
                    <Tooltip title="Test (Enter)">
                        <span><Button variant="outlined" onClick={() => evaluate(selector)} disabled={!selector.trim()} sx={{ minWidth: 0, px: 1.25, height: '100%' }}><Play size={15} /></Button></span>
                    </Tooltip>
                </Box>
                {!selector && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                        <Typography variant="caption" sx={{ mr: 0.25, alignSelf: 'center' }}>Try:</Typography>
                        {EXAMPLES.map(x => <Chip key={x} size="small" variant="outlined" label={x} onClick={() => use(x)} sx={{ fontFamily: 'monospace', fontSize: '0.64rem', height: 20 }} />)}
                    </Stack>
                )}
            </Box>
            {error && <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}

            {result && (
                <Box sx={{ border: 1, borderColor: result.count > 0 ? 'divider' : 'rgba(244,63,94,0.4)', borderRadius: '12px', p: 1.5, bgcolor: 'background.paper' }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1, color: result.count > 0 ? 'text.primary' : 'error.main' }}>{result.count}</Typography>
                        <Typography variant="caption" sx={{ flex: 1 }}>
                            match{result.count !== 1 ? 'es' : ''} · {result.kind.toUpperCase()}{result.count > 0 ? ' · highlighted on the page' : ''}
                        </Typography>
                        <GradeChip ev={result} />
                        <CopyButton text={result.selector} label="Copy selector" />
                    </Box>
                    <Typography variant="caption" display="block" sx={{ mb: result.samples.length ? 1 : 0 }}>
                        {result.count === 0 && !result.error ? 'Nothing matches. Check the spelling, or pick the element instead.' : result.grade.reason}
                    </Typography>
                    {result.samples.length > 0 && (
                        <Stack spacing={0.25} sx={{ bgcolor: 'rgb(var(--cp-ink-rgb) / 0.05)', borderRadius: '6px', p: 0.75 }}>
                            {result.samples.map((s, i) => (
                                <Box key={i} sx={{ display: 'flex', gap: 0.75, minWidth: 0 }}>
                                    <Typography variant="caption" sx={{ color: '#F59E0B', fontWeight: 700, minWidth: 14, textAlign: 'right' }}>{i + 1}</Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s || <em>(no text)</em>}</Typography>
                                </Box>
                            ))}
                            {result.count > result.samples.length && <Typography variant="caption" sx={{ pl: 2.75 }}>…and {result.count - result.samples.length} more</Typography>}
                        </Stack>
                    )}
                </Box>
            )}

            {pick && (
                <Box>
                    <GroupLabel>Ways to find &lt;{pick.tag}&gt; “{pick.text.slice(0, 32)}{pick.text.length > 32 ? '…' : ''}”</GroupLabel>
                    {pick.candidates.length === 0 && <Typography variant="caption">No selector found for this element.</Typography>}
                    <Stack spacing={0.75}>
                        {candidates.map((c, i) => <CandidateCard key={c.selector} c={c} best={i === 0 && c.grade.grade === 'strong'} active={result?.selector === c.selector} onUse={() => use(c.selector)} />)}
                    </Stack>
                    {pick.candidates.length > CANDIDATES_SHOWN && (
                        <Button size="small" onClick={() => setShowAll(s => !s)} sx={{ mt: 0.5 }}>
                            {showAll ? 'Show fewer' : `Show ${pick.candidates.length - CANDIDATES_SHOWN} more`}
                        </Button>
                    )}
                </Box>
            )}

            {snippet && (
                <DetailSection icon={<Code2 size={14} />} title="Use it in code" summary={SNIPPET_LABELS[target]} defaultOpen>
                    <ToggleButtonGroup size="small" exclusive value={target} onChange={(_, v) => v && setTarget(v)} sx={{ flexWrap: 'wrap', mb: 0.75, gap: 0.5, '& .MuiToggleButtonGroup-grouped': { border: '1px solid rgb(var(--cp-ink-rgb) / 0.08) !important', borderRadius: '6px !important' } }}>
                        {(Object.keys(SNIPPET_LABELS) as SnippetTarget[]).map(k => (
                            <ToggleButton key={k} value={k} sx={{ py: 0.2, px: 0.9, fontSize: '0.64rem', textTransform: 'none' }}>{SNIPPET_LABELS[k]}</ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    <CodeBlock code={snippet} />
                </DetailSection>
            )}

            {pick && (
                <DetailSection icon={<Database size={14} />} title="What a saved recipe stores" summary={`${pick.stored.length} backups`}>
                    <Box sx={{ display: 'flex', gap: 0.75, mb: 1 }}>
                        <Info size={13} style={{ color: 'var(--cp-text-3)', marginTop: 2, flexShrink: 0 }} />
                        <Typography variant="caption">Recipes keep several ways to find each element, best first. If the site changes and the first stops working, a run falls back to the next.</Typography>
                    </Box>
                    <Stack spacing={1.25}>
                        <StoredChain title="This element (Page Extractor)" entries={pick.stored} onUse={use} />
                        {pick.storedList && (
                            <>
                                <StoredChain title="Its list: container" entries={pick.storedList.container} onUse={use} />
                                <StoredChain title="Its list: items (inside the container)" entries={pick.storedList.items} />
                            </>
                        )}
                    </Stack>
                </DetailSection>
            )}
        </Stack>
    );
}
