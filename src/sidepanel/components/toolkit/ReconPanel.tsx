import { useState } from 'react';
import { Button, Chip, Collapse, IconButton, Notice, Progress, Stack, Text, Tooltip, cx } from '../../ui';
import {
    Radar, Code2, Globe, Shield, FileJson, ListOrdered, Zap, MonitorSmartphone, ShieldAlert, FileCode2,
    Crosshair, Network, List, RotateCw, ClipboardCopy, Check, Lightbulb,
} from 'lucide-react';
import type { ReconReport, Recommendation } from '../../../shared/recon/types';
import { recommend } from '../../../shared/recon/recommend';
import { approachLabel, dataFact, paginationFact, protectionFact, reconMarkdown, renderingFact } from '../../../shared/recon/summary';
import { copyText } from '../../services/clipboard';
import { samePage, useToolkit } from './context';
import { CopyButton, DetailSection, FactTile, GroupLabel, InfoRow, TONE, Tone, ToolIntro } from './ui';

const APPROACH: Record<Recommendation['approach'], { tone: Tone; icon: React.ReactNode }> = {
    'http-json': { tone: 'good', icon: <FileCode2 size={18} /> },
    'http-html': { tone: 'good', icon: <Zap size={18} /> },
    browser: { tone: 'warn', icon: <MonitorSmartphone size={18} /> },
    blocked: { tone: 'bad', icon: <ShieldAlert size={18} /> },
};

const CHECKS = ['Bot protection and block pages', 'Server HTML vs. what JavaScript renders', 'Embedded JSON (JSON-LD, app state)', 'robots.txt, sitemaps and pagination'];

/** The next things to do for this kind of page, as buttons into the other tools. */
function NextSteps({ rec, report }: { rec: Recommendation; report: ReconReport }) {
    const { openTool, navigate } = useToolkit();
    const steps: { label: string; icon: React.ReactNode; onClick: () => void }[] = [];
    if (rec.approach === 'http-json') steps.push({ label: 'See the embedded JSON', icon: <FileJson />, onClick: () => openTool('data') });
    if (rec.approach === 'browser' || report.pagination.loadMore) steps.push({ label: 'Find the API it calls', icon: <Network />, onClick: () => openTool('api') });
    if (rec.approach !== 'blocked') steps.push({ label: 'Test a selector', icon: <Crosshair />, onClick: () => openTool('lab') });
    if (rec.approach !== 'blocked' && navigate) steps.push({ label: 'Extract a list', icon: <List />, onClick: () => navigate('list-extractor') });
    if (steps.length === 0) return null;
    return (
        <div className="mt-3 flex flex-wrap gap-1.5">
            {steps.map(s => <Button key={s.label} size="sm" icon={s.icon} onClick={s.onClick}>{s.label}</Button>)}
        </div>
    );
}

/** What the page embeds, one line each; the data itself is in the Data tab. */
function EmbeddedList({ report }: { report: ReconReport }) {
    const { openTool } = useToolkit();
    if (report.embedded.length === 0) return <Text size="caption" tone="muted">No JSON-LD, app state or microdata found. The data is only in the page's HTML (or comes from an API: try the API Finder).</Text>;
    return (
        <Stack gap={1.5}>
            {report.embedded.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <Text size="caption" weight="semibold" truncate>{e.label}</Text>
                        {e.types && e.types.length > 0 && <Text size="caption" tone="faint" className="text-[10.5px]">{e.types.slice(0, 4).join(' · ')}</Text>}
                    </div>
                    <Text size="caption" tone="muted">{e.kind === 'microdata' || e.kind === 'opengraph' ? `${e.size} fields` : `${(e.size / 1024).toFixed(1)} KB`}</Text>
                </div>
            ))}
            <Button size="sm" icon={<FileJson />} onClick={() => openTool('data')}>Explore it in the Data tab</Button>
        </Stack>
    );
}

export default function ReconPanel() {
    const { page, send } = useToolkit();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<ReconReport | null>(null);
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


    const rec = report ? recommend(report) : null;
    const stale = report && page.url && !samePage(report.url, page.url);

    if (!report) {
        return (
            <Stack gap={3}>
                <ToolIntro icon={<Radar />} title="How should I scrape this page?"
                    text="One click checks the page and tells you the simplest way to get its data: a plain HTTP request, its JSON, or a real browser."
                    points={CHECKS}>
                    <Button fullWidth variant="primary" onClick={run} disabled={!page.web} loading={loading} icon={<Radar />}>
                        {loading ? 'Analysing this page…' : 'Analyse this page'}
                    </Button>
                    <Collapse open={loading}>
                        <Progress size="sm" className="mt-3" label="Analysing" />
                        <Text size="caption" tone="muted" className="mt-1.5 text-center">Fetching the served HTML and robots.txt: a few seconds.</Text>
                    </Collapse>
                </ToolIntro>
                {error && <Notice tone="warning">{error}</Notice>}
            </Stack>
        );
    }

    const approach = APPROACH[rec!.approach];
    const tone = TONE[approach.tone];
    const facts = [
        { icon: <Shield />, label: 'Protection', ...protectionFact(report) },
        { icon: <Code2 />, label: 'Rendering', ...renderingFact(report) },
        { icon: <FileJson />, label: 'Embedded data', ...dataFact(report) },
        { icon: <ListOrdered />, label: 'Pagination', ...paginationFact(report) },
    ];

    return (
        <Stack gap={3}>
            {stale && (
                <Notice tone="info" icon={<RotateCw />} action={<Button size="sm" onClick={run} disabled={loading}>Analyse</Button>}>
                    This report is for another page. Analyse the one you're on?
                </Notice>
            )}

            <div className={cx('rounded-card border-[1.5px] border-line-strong p-4 shadow-press', tone.box)}>
                <div className="mb-1.5 flex items-center gap-2">
                    <span className={cx('flex', tone.text)}>{approach.icon}</span>
                    <span className={cx('flex-1 text-small font-extrabold', tone.text)}>{approachLabel(rec!.approach)}</span>
                    <IconButton size="sm" label={copied ? 'Copied' : 'Copy the report as Markdown'}
                        onClick={async () => { await copyText(reconMarkdown(report, rec!)); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                        {copied ? <Check /> : <ClipboardCopy />}
                    </IconButton>
                    <IconButton size="sm" label="Analyse again" onClick={run} disabled={loading}><RotateCw className={loading ? 'animate-spin' : undefined} /></IconButton>
                </div>
                <p className="m-0 font-display text-lead font-bold leading-snug tracking-[-0.01em] text-ink">{rec!.headline}</p>
                <NextSteps rec={rec!} report={report} />
            </div>
            {error && <Notice tone="warning" onClose={() => setError(null)}>{error}</Notice>}

            <div className="grid grid-cols-2 gap-1.5">
                {facts.map(f => <FactTile key={f.label} icon={f.icon} label={f.label} value={f.value} tone={f.tone} />)}
            </div>

            {rec!.notes.length > 0 && (
                <div className="rounded-card bg-tile-butter p-4">
                    <GroupLabel>Good to know</GroupLabel>
                    <Stack gap={1.5}>
                        {rec!.notes.map((n, i) => (
                            <div key={i} className="flex gap-2">
                                <Lightbulb size={14} className="mt-0.5 shrink-0 text-ink" />
                                <Text size="caption">{n}</Text>
                            </div>
                        ))}
                    </Stack>
                </div>
            )}

            <GroupLabel>Details</GroupLabel>
            <div className="-mt-2">
                <DetailSection icon={<FileJson />} title="Embedded data" summary={dataFact(report).value}>
                    <EmbeddedList report={report} />
                </DetailSection>
            </div>
            <DetailSection icon={<Shield />} title="Protection" summary={protectionFact(report).value}>
                <div className="flex flex-wrap gap-1.5">
                    {report.check.botManagers.map(b => (
                        <Tooltip key={b.id} title={`Seen: ${b.evidence}`}><span><Chip tone="warning">{b.name}</Chip></span></Tooltip>
                    ))}
                </div>
                {report.check.botManagers.length === 0 && <Text size="caption" tone="muted">No bot-management vendor or CAPTCHA seen on this page.</Text>}
                {report.check.reason && <Text size="caption" tone="muted" className="mt-1.5">{report.check.reason}</Text>}
            </DetailSection>
            <DetailSection icon={<Code2 />} title="Rendering" summary={renderingFact(report).value}>
                {report.rendering.frameworks.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">{report.rendering.frameworks.map(f => <Chip key={f}>{f}</Chip>)}</div>
                )}
                <InfoRow label="Text on the page now" value={`${report.rendering.liveTextLength.toLocaleString()} chars`} />
                {report.rendering.servedTextLength != null && <InfoRow label="Text in the HTML the server sent" value={`${report.rendering.servedTextLength.toLocaleString()} chars`} />}
                {report.rendering.servedStatus != null && <InfoRow label="Plain request status" value={report.rendering.servedStatus} />}
            </DetailSection>
            <DetailSection icon={<ListOrdered />} title="Pagination" summary={paginationFact(report).value}>
                <InfoRow label='rel="next" link' value={report.pagination.relNext || '—'} mono={!!report.pagination.relNext} />
                <InfoRow label="Page number in URL" value={report.pagination.pageParam ? `?${report.pagination.pageParam}=` : '—'} />
                <InfoRow label='"Next" button' value={report.pagination.nextButton ? 'Yes' : 'No'} />
                <InfoRow label='"Load more" button' value={report.pagination.loadMore ? 'Yes' : 'No'} />
            </DetailSection>
            <DetailSection icon={<Globe />} title="Discovery"
                summary={!report.robots?.found ? 'No robots.txt' : report.robots.allowed ? `Allowed · ${report.robots.sitemaps.length} sitemaps` : 'Disallowed by robots.txt'}>
                <InfoRow label="Canonical" value={report.canonical || '—'} mono={!!report.canonical} />
                <InfoRow label="robots.txt" value={!report.robots?.found ? 'Not found' : report.robots.allowed ? `Allowed${report.robots.rule ? ` (${report.robots.rule})` : ''}` : `Disallowed (${report.robots.rule})`} />
                {report.robots?.crawlDelay != null && <InfoRow label="Crawl-delay" value={`${report.robots.crawlDelay}s`} />}
                {report.robotsMeta && <InfoRow label="Robots meta" value={report.robotsMeta} />}
                <InfoRow label="Language versions (hreflang)" value={report.hreflangCount} />
                {(report.robots?.sitemaps.length ?? 0) > 0 && (
                    <div className="mt-2">
                        <GroupLabel action={<CopyButton text={report.robots!.sitemaps.join('\n')} label="Copy sitemap URLs" />}>Sitemaps</GroupLabel>
                        {report.robots!.sitemaps.slice(0, 6).map(s => <Text key={s} size="caption" mono className="break-all">{s}</Text>)}
                    </div>
                )}
                {report.feeds.length > 0 && (
                    <div className="mt-2">
                        <GroupLabel action={<CopyButton text={report.feeds.join('\n')} label="Copy feed URLs" />}>Feeds</GroupLabel>
                        {report.feeds.map(f => <Text key={f} size="caption" mono className="break-all">{f}</Text>)}
                    </div>
                )}
            </DetailSection>
        </Stack>
    );
}
