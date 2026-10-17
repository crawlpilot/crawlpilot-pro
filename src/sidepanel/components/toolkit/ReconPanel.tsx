import { useState } from 'react';
import { Box, Button, Chip, Stack, Typography, Collapse, IconButton, Tooltip, CircularProgress, Alert } from '@mui/material';
import { Radar, Copy, ChevronDown, Code2, Globe, Shield, FileJson, ListOrdered, Check } from 'lucide-react';
import type { ReconReport, Recommendation } from '../../../shared/recon/types';
import { recommend } from '../../../shared/recon/recommend';
import { VERDICT_LABELS } from '../../../shared/verdict/classifyPage';
import { sendToActiveTab, copyText } from './tabMessaging';

const APPROACH_LABEL: Record<Recommendation['approach'], { label: string; color: 'success' | 'info' | 'warning' | 'error' }> = {
    'http-json': { label: 'HTTP + JSON', color: 'success' },
    'http-html': { label: 'HTTP + HTML', color: 'success' },
    browser: { label: 'Needs a browser', color: 'warning' },
    blocked: { label: 'Blocked', color: 'error' },
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
            <Typography variant="overline" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', fontWeight: 700, lineHeight: 1.6 }}>
                {icon}{title}
            </Typography>
            <Box sx={{ mt: 0.5 }}>{children}</Box>
        </Box>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25, fontSize: 12 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="caption" sx={{ textAlign: 'right', wordBreak: 'break-all' }}>{value}</Typography>
        </Box>
    );
}

function CopyButton({ text }: { text: string }) {
    const [done, setDone] = useState(false);
    return (
        <Tooltip title={done ? 'Copied' : 'Copy'}>
            <IconButton size="small" onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
                {done ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
        </Tooltip>
    );
}

export default function ReconPanel() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<ReconReport | null>(null);
    const [open, setOpen] = useState<number | null>(null);

    const run = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await sendToActiveTab<{ report: ReconReport }>({ type: 'CMD_RECON' });
            setReport(res.report);
            setOpen(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const rec = report ? recommend(report) : null;
    const r = report;

    return (
        <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
                Find out where this page's data lives, what protects it and how it paginates, before you write a scraper.
            </Typography>
            <Button variant="contained" onClick={run} disabled={loading}
                startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Radar size={16} />}>
                {loading ? 'Analysing…' : report ? 'Analyse again' : 'Analyse this page'}
            </Button>
            {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

            {r && rec && (
                <>
                    <Box sx={{ borderRadius: 2, p: 1.5, border: 1, borderColor: `${APPROACH_LABEL[rec.approach].color}.main`, bgcolor: 'action.hover' }}>
                        <Chip size="small" color={APPROACH_LABEL[rec.approach].color} label={APPROACH_LABEL[rec.approach].label} sx={{ mb: 1, fontWeight: 700 }} />
                        <Typography variant="body2" fontWeight={600}>{rec.headline}</Typography>
                        {rec.notes.length > 0 && (
                            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                                {rec.notes.map((n, i) => <Typography key={i} component="li" variant="caption" color="text.secondary" display="list-item">{n}</Typography>)}
                            </Box>
                        )}
                    </Box>

                    <Section icon={<Shield size={13} />} title="Page check">
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={VERDICT_LABELS[r.check.verdict]} color={r.check.verdict === 'ok' ? 'success' : 'error'} variant="outlined" />
                            {r.check.botManagers.map(b => (
                                <Tooltip key={b.id} title={`Seen: ${b.evidence}`}><Chip size="small" label={b.name} variant="outlined" color="warning" /></Tooltip>
                            ))}
                            {r.check.botManagers.length === 0 && <Typography variant="caption" color="text.secondary">No bot protection seen.</Typography>}
                        </Stack>
                    </Section>

                    <Section icon={<Code2 size={13} />} title="Rendering">
                        {r.rendering.frameworks.length > 0 && (
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                                {r.rendering.frameworks.map(f => <Chip key={f} size="small" label={f} />)}
                            </Stack>
                        )}
                        <Row label="Text on the page now" value={`${r.rendering.liveTextLength.toLocaleString()} chars`} />
                        {r.rendering.servedTextLength != null && (
                            <Row label="Text in the HTML the server sent" value={`${r.rendering.servedTextLength.toLocaleString()} chars`} />
                        )}
                        {r.rendering.servedStatus != null && <Row label="Plain request status" value={r.rendering.servedStatus} />}
                        <Row label="Needs JavaScript" value={r.rendering.needsJs ? 'Yes' : r.rendering.needsJs === false ? 'No' : 'Unknown'} />
                    </Section>

                    <Section icon={<FileJson size={13} />} title={`Embedded data (${r.embedded.length})`}>
                        {r.embedded.length === 0 && <Typography variant="caption" color="text.secondary">No JSON-LD, app state or microdata found.</Typography>}
                        <Stack spacing={0.5}>
                            {r.embedded.map((e, i) => (
                                <Box key={i} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5 }}>
                                        <Typography variant="caption" fontWeight={600} sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</Typography>
                                        <Typography variant="caption" color="text.secondary">{e.kind === 'microdata' || e.kind === 'opengraph' ? `${e.size}` : `${(e.size / 1024).toFixed(1)} KB`}</Typography>
                                        {e.json && <CopyButton text={e.json} />}
                                        {e.json && (
                                            <IconButton size="small" onClick={() => setOpen(open === i ? null : i)}>
                                                <ChevronDown size={14} style={{ transform: open === i ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                                            </IconButton>
                                        )}
                                    </Box>
                                    <Collapse in={open === i} unmountOnExit>
                                        <Box component="pre" sx={{ m: 0, p: 1, maxHeight: 260, overflow: 'auto', fontSize: 11, bgcolor: 'background.default', borderTop: 1, borderColor: 'divider' }}>
                                            {e.json?.slice(0, 20000)}
                                        </Box>
                                    </Collapse>
                                </Box>
                            ))}
                        </Stack>
                    </Section>

                    <Section icon={<Globe size={13} />} title="Discovery">
                        <Row label="Canonical" value={r.canonical || '—'} />
                        <Row label="robots.txt" value={!r.robots?.found ? 'Not found' : r.robots.allowed ? `Allowed${r.robots.rule ? ` (${r.robots.rule})` : ''}` : `Disallowed (${r.robots.rule})`} />
                        {r.robots?.crawlDelay != null && <Row label="Crawl-delay" value={`${r.robots.crawlDelay}s`} />}
                        {r.robotsMeta && <Row label="Robots meta" value={r.robotsMeta} />}
                        <Row label="Language versions (hreflang)" value={r.hreflangCount} />
                        {(r.robots?.sitemaps.length ?? 0) > 0 && (
                            <Box sx={{ mt: 0.75 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Sitemaps</Typography>
                                    <CopyButton text={r.robots!.sitemaps.join('\n')} />
                                </Box>
                                {r.robots!.sitemaps.slice(0, 6).map(s => <Typography key={s} variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{s}</Typography>)}
                            </Box>
                        )}
                        {r.feeds.length > 0 && (
                            <Box sx={{ mt: 0.75 }}>
                                <Typography variant="caption" color="text.secondary">Feeds</Typography>
                                {r.feeds.map(f => <Typography key={f} variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{f}</Typography>)}
                            </Box>
                        )}
                    </Section>

                    <Section icon={<ListOrdered size={13} />} title="Pagination">
                        <Row label='rel="next" link' value={r.pagination.relNext || '—'} />
                        <Row label="Page number in URL" value={r.pagination.pageParam ? `?${r.pagination.pageParam}=` : '—'} />
                        <Row label='"Next" button' value={r.pagination.nextButton ? 'Yes' : 'No'} />
                        <Row label='"Load more" button' value={r.pagination.loadMore ? 'Yes' : 'No'} />
                    </Section>
                </>
            )}
        </Stack>
    );
}
