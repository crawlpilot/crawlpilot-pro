import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import {
    Radar, ChevronDown, Code2, Globe, Shield, FileJson, ListOrdered, Zap, MonitorSmartphone, ShieldAlert, FileCode2,
    Crosshair, Network, List, RotateCw, ClipboardCopy, Check, Lightbulb,
} from 'lucide-react';
import type { ReconReport, Recommendation } from '../../../shared/recon/types';
import { recommend } from '../../../shared/recon/recommend';
import { approachLabel, dataFact, paginationFact, protectionFact, reconMarkdown, renderingFact } from '../../../shared/recon/summary';
import { copyText } from '../../services/clipboard';
import { samePage, useToolkit } from './context';
import { CodeBlock, CopyButton, DetailSection, FactTile, GroupLabel, InfoRow, TONE, Tone, ToolIntro } from './ui';

const APPROACH: Record<Recommendation['approach'], { tone: Tone; icon: React.ReactNode }> = {
    'http-json': { tone: 'good', icon: <FileCode2 size={18} /> },
    'http-html': { tone: 'good', icon: <Zap size={18} /> },
    browser: { tone: 'warn', icon: <MonitorSmartphone size={18} /> },
    blocked: { tone: 'bad', icon: <ShieldAlert size={18} /> },
};

const CHECKS = ['Bot protection and block pages', 'Server HTML vs. what JavaScript renders', 'Embedded JSON (JSON-LD, app state)', 'robots.txt, sitemaps and pagination'];

/** The next things to do for this kind of page, as buttons into the other tools. */
function NextSteps({ rec, report, onShowData }: { rec: Recommendation; report: ReconReport; onShowData: () => void }) {
    const { openTool, navigate } = useToolkit();
    const steps: { label: string; icon: React.ReactNode; onClick: () => void }[] = [];
    if (rec.approach === 'http-json') steps.push({ label: 'See the embedded JSON', icon: <FileJson size={14} />, onClick: onShowData });
    if (rec.approach === 'browser' || report.pagination.loadMore) steps.push({ label: 'Find the API it calls', icon: <Network size={14} />, onClick: () => openTool('api') });
    if (rec.approach !== 'blocked') steps.push({ label: 'Test a selector', icon: <Crosshair size={14} />, onClick: () => openTool('lab') });
    if (rec.approach !== 'blocked' && navigate) steps.push({ label: 'Extract a list', icon: <List size={14} />, onClick: () => navigate('list-extractor') });
    if (steps.length === 0) return null;
    return (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            {steps.map(s => (
                <Button key={s.label} size="small" variant="outlined" color="inherit" startIcon={s.icon} onClick={s.onClick}
                    sx={{ borderColor: 'divider', color: 'text.primary', fontSize: '0.7rem', py: 0.25 }}>{s.label}</Button>
            ))}
        </Stack>
    );
}

function EmbeddedList({ report }: { report: ReconReport }) {
    const [open, setOpen] = useState<number | null>(report.embedded.findIndex(e => e.json));
    if (report.embedded.length === 0) return <Typography variant="caption">No JSON-LD, app state or microdata found. The data is only in the page's HTML (or comes from an API: try the API Finder).</Typography>;
    return (
        <Stack spacing={0.75}>
            {report.embedded.map((e, i) => (
                <Box key={i} sx={{ border: 1, borderColor: open === i ? 'rgba(245,158,11,0.4)' : 'divider', borderRadius: '10px', overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.25, pr: 0.5, py: 0.5, cursor: e.json ? 'pointer' : 'default' }}
                        onClick={() => e.json && setOpen(open === i ? null : i)}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</Typography>
                            {e.types && e.types.length > 0 && <Typography variant="caption" sx={{ fontSize: '0.62rem' }}>{e.types.slice(0, 4).join(' · ')}</Typography>}
                        </Box>
                        <Typography variant="caption">{e.kind === 'microdata' || e.kind === 'opengraph' ? `${e.size} fields` : `${(e.size / 1024).toFixed(1)} KB`}</Typography>
                        {e.json && <CopyButton text={e.json} label="Copy JSON" />}
                        {e.json && (
                            <IconButton size="small" aria-label={open === i ? 'Hide JSON' : 'Show JSON'}>
                                <ChevronDown size={14} style={{ transform: open === i ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                            </IconButton>
                        )}
                    </Box>
                    <Collapse in={open === i} unmountOnExit>
                        <Box sx={{ p: 0.75, pt: 0 }}><CodeBlock code={e.json?.slice(0, 20000) ?? ''} maxHeight={260} /></Box>
                    </Collapse>
                </Box>
            ))}
        </Stack>
    );
}

export default function ReconPanel() {
    const { page, send } = useToolkit();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<ReconReport | null>(null);
    const [showData, setShowData] = useState(0);
    const [copied, setCopied] = useState(false);

    const run = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await send('CMD_RECON');
            setReport(res.report);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // A finished report scrolls the data section into view when asked from the verdict card.
    useEffect(() => {
        if (showData) document.getElementById('recon-embedded')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [showData]);

    const rec = report ? recommend(report) : null;
    const stale = report && page.url && !samePage(report.url, page.url);

    if (!report) {
        return (
            <Stack spacing={1.5}>
                <ToolIntro icon={<Radar size={18} />} title="How should I scrape this page?"
                    text="One click checks the page and tells you the simplest way to get its data: a plain HTTP request, its JSON, or a real browser."
                    points={CHECKS}>
                    <Button fullWidth variant="contained" color="warning" onClick={run} disabled={loading || !page.web}
                        startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Radar size={16} />}
                        sx={{ color: '#1a1205', fontWeight: 700 }}>
                        {loading ? 'Analysing this page…' : 'Analyse this page'}
                    </Button>
                    {loading && <LinearProgress color="warning" sx={{ mt: 1, borderRadius: '6px', height: 3 }} />}
                    {loading && <Typography variant="caption" display="block" sx={{ mt: 0.75, textAlign: 'center' }}>Fetching the served HTML and robots.txt: a few seconds.</Typography>}
                </ToolIntro>
                {error && <Alert severity="warning" variant="outlined">{error}</Alert>}
            </Stack>
        );
    }

    const approach = APPROACH[rec!.approach];
    const tone = TONE[approach.tone];
    const facts = [
        { icon: <Shield size={12} />, label: 'Protection', ...protectionFact(report) },
        { icon: <Code2 size={12} />, label: 'Rendering', ...renderingFact(report) },
        { icon: <FileJson size={12} />, label: 'Embedded data', ...dataFact(report) },
        { icon: <ListOrdered size={12} />, label: 'Pagination', ...paginationFact(report) },
    ];

    return (
        <Stack spacing={1.5}>
            {stale && (
                <Alert severity="info" variant="outlined" icon={<RotateCw size={16} />}
                    action={<Button size="small" color="inherit" onClick={run} disabled={loading}>Analyse</Button>}>
                    This report is for another page. Analyse the one you're on?
                </Alert>
            )}

            {/* Verdict */}
            <Box sx={{ borderRadius: '16px', p: 1.75, border: 1, borderColor: tone.border, bgcolor: tone.bg }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Box sx={{ color: tone.fg, display: 'flex' }}>{approach.icon}</Box>
                    <Typography variant="caption" sx={{ color: tone.fg, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                        {approachLabel(rec!.approach)}
                    </Typography>
                    <Tooltip title={copied ? 'Copied' : 'Copy the report as Markdown'}>
                        <IconButton size="small" onClick={async () => { await copyText(reconMarkdown(report, rec!)); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                            {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Analyse again">
                        <span>
                            <IconButton size="small" onClick={run} disabled={loading}>{loading ? <CircularProgress size={14} /> : <RotateCw size={15} />}</IconButton>
                        </span>
                    </Tooltip>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 600, lineHeight: 1.45 }}>{rec!.headline}</Typography>
                <NextSteps rec={rec!} report={report} onShowData={() => setShowData(n => n + 1)} />
            </Box>
            {error && <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}

            {/* At a glance */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
                {facts.map(f => <FactTile key={f.label} icon={f.icon} label={f.label} value={f.value} tone={f.tone} />)}
            </Box>

            {rec!.notes.length > 0 && (
                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.5 }}>
                    <GroupLabel>Good to know</GroupLabel>
                    <Stack spacing={0.75}>
                        {rec!.notes.map((n, i) => (
                            <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                                <Lightbulb size={13} style={{ color: '#F59E0B', marginTop: 2, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>{n}</Typography>
                            </Box>
                        ))}
                    </Stack>
                </Box>
            )}

            {/* Details */}
            <GroupLabel>Details</GroupLabel>
            <Box id="recon-embedded">
                <DetailSection key={`data-${showData}`} icon={<FileJson size={14} />} title="Embedded data" summary={dataFact(report).value} defaultOpen={showData > 0}>
                    <EmbeddedList report={report} />
                </DetailSection>
            </Box>
            <DetailSection icon={<Shield size={14} />} title="Protection" summary={protectionFact(report).value}>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {report.check.botManagers.map(b => (
                        <Tooltip key={b.id} title={`Seen: ${b.evidence}`}><Chip size="small" label={b.name} variant="outlined" color="warning" /></Tooltip>
                    ))}
                </Stack>
                {report.check.botManagers.length === 0 && <Typography variant="caption">No bot-management vendor or CAPTCHA seen on this page.</Typography>}
                {report.check.reason && <Typography variant="caption" display="block" sx={{ mt: 0.75 }}>{report.check.reason}</Typography>}
            </DetailSection>
            <DetailSection icon={<Code2 size={14} />} title="Rendering" summary={renderingFact(report).value}>
                {report.rendering.frameworks.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                        {report.rendering.frameworks.map(f => <Chip key={f} size="small" label={f} />)}
                    </Stack>
                )}
                <InfoRow label="Text on the page now" value={`${report.rendering.liveTextLength.toLocaleString()} chars`} />
                {report.rendering.servedTextLength != null && <InfoRow label="Text in the HTML the server sent" value={`${report.rendering.servedTextLength.toLocaleString()} chars`} />}
                {report.rendering.servedStatus != null && <InfoRow label="Plain request status" value={report.rendering.servedStatus} />}
            </DetailSection>
            <DetailSection icon={<ListOrdered size={14} />} title="Pagination" summary={paginationFact(report).value}>
                <InfoRow label='rel="next" link' value={report.pagination.relNext || '—'} mono={!!report.pagination.relNext} />
                <InfoRow label="Page number in URL" value={report.pagination.pageParam ? `?${report.pagination.pageParam}=` : '—'} />
                <InfoRow label='"Next" button' value={report.pagination.nextButton ? 'Yes' : 'No'} />
                <InfoRow label='"Load more" button' value={report.pagination.loadMore ? 'Yes' : 'No'} />
            </DetailSection>
            <DetailSection icon={<Globe size={14} />} title="Discovery"
                summary={!report.robots?.found ? 'No robots.txt' : report.robots.allowed ? `Allowed · ${report.robots.sitemaps.length} sitemaps` : 'Disallowed by robots.txt'}>
                <InfoRow label="Canonical" value={report.canonical || '—'} mono={!!report.canonical} />
                <InfoRow label="robots.txt" value={!report.robots?.found ? 'Not found' : report.robots.allowed ? `Allowed${report.robots.rule ? ` (${report.robots.rule})` : ''}` : `Disallowed (${report.robots.rule})`} />
                {report.robots?.crawlDelay != null && <InfoRow label="Crawl-delay" value={`${report.robots.crawlDelay}s`} />}
                {report.robotsMeta && <InfoRow label="Robots meta" value={report.robotsMeta} />}
                <InfoRow label="Language versions (hreflang)" value={report.hreflangCount} />
                {(report.robots?.sitemaps.length ?? 0) > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <GroupLabel action={<CopyButton text={report.robots!.sitemaps.join('\n')} label="Copy sitemap URLs" />}>Sitemaps</GroupLabel>
                        {report.robots!.sitemaps.slice(0, 6).map(s => <Typography key={s} variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'text.primary' }}>{s}</Typography>)}
                    </Box>
                )}
                {report.feeds.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <GroupLabel action={<CopyButton text={report.feeds.join('\n')} label="Copy feed URLs" />}>Feeds</GroupLabel>
                        {report.feeds.map(f => <Typography key={f} variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'text.primary' }}>{f}</Typography>)}
                    </Box>
                )}
            </DetailSection>
        </Stack>
    );
}
