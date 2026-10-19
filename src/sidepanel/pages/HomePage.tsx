/**
 * Home starts from the page you're on (docs/plans/ux-simplification-plan.md §4.2): which page,
 * one suggestion for it ("24 products on this page · Get them as a table"), four tools that work on any
 * computer, the AI tools only where Chrome's built-in AI is available, your recent tables, and the rest
 * one tap further.
 */
import { ReactNode, useEffect, useState } from 'react';
import {
    ArrowRight, ChevronRight, FileText, Files, Image as ImageIcon, Layers, List, MessageSquareText, MousePointerClick,
    Radar, ShoppingBag, Sparkles, Table2, Unlock,
 Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePageTab } from '../hooks/usePageTab';
import PageStrip from '../components/ui/PageStrip';
import { sendToPage } from '../../shared/messages';
import type { PageSummary } from '../../shared/types/pageSummary';
import type { Table } from '../../shared/types/database';
import { db } from '../../shared/db';
import { modelStatus } from '../services/ai/modelHost';
import { getSummarizerAvailability } from '../services/ai/summarizer';
import { Button, Card, CardButton, Disclosure, Heading, Row, Skeleton, Stack, Text, type Tone } from '../ui';

interface HomePageProps {
    onNavigate: (view: string) => void;
    isTabConnected?: boolean;
}

const RECENT = 3;

/** The page check, redone when the page changes; null while it runs, `none` when it can't run. */
function usePageSummary(page: ReturnType<typeof usePageTab>, connected: boolean): PageSummary | null {
    const [summary, setSummary] = useState<PageSummary | null>(null);
    useEffect(() => {
        let alive = true;
        setSummary(null);
        if (!page.web || !connected) { setSummary({ kind: 'none', noun: 'items' }); return; }
        // The page may still be loading its list: ask again once after a moment if nothing was found.
        const ask = (retry: boolean) => sendToPage(page.tab, 'PAGE_SUMMARY')
            .then(res => {
                if (!alive) return;
                setSummary(res.summary);
                if (retry && res.summary.kind === 'none') setTimeout(() => alive && ask(false), 1500);
            })
            .catch(() => alive && setSummary({ kind: 'none', noun: 'items' }));
        void ask(true);
        return () => { alive = false; };
    }, [page.tab?.id, page.url, page.web, connected]);
    return summary;
}

function useRecentTables(): Table[] {
    const [tables, setTables] = useState<Table[]>([]);
    useEffect(() => {
        db.tables.list(20).then(all => setTables(all.filter(t => !t.preview && t.rowCount > 0).slice(0, RECENT))).catch(() => undefined);
    }, []);
    return tables;
}

/**
 * Whether this computer has Chrome's built-in AI (the Prompt or Summarizer API, ready or downloadable):
 * the AI tools need it, so Home leads with the tools that work everywhere. null while checking.
 */
function useAiReady(): boolean | null {
    const [ready, setReady] = useState<boolean | null>(null);
    useEffect(() => {
        let alive = true;
        Promise.all([modelStatus().then(s => s.availability), getSummarizerAvailability()])
            .then(all => alive && setReady(all.some(a => a !== 'unavailable')))
            .catch(() => alive && setReady(false));
        return () => { alive = false; };
    }, []);
    return ready;
}

function openTable(id?: number) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table${id ? `&tableId=${id}` : ''}`) });
}

/** The one thing to do with this page. */
function Suggestion({ summary, web, ai, onNavigate }: { summary: PageSummary | null; web: boolean; ai: boolean; onNavigate: (view: string) => void }) {
    const { t } = useTranslation('home');
    if (!summary) {
        return (
            <Card>
                <Text size="caption" tone="faint">{t('page.checking')}</Text>
                <Skeleton className="mt-2 h-6 w-3/4" />
                <Skeleton className="mt-3 h-9 w-44 rounded-control" />
            </Card>
        );
    }
    const s: { icon: ReactNode; title: string; hint?: string; action: string; view: string; secondary?: { label: string; view: string } } =
        summary.kind === 'list' ? { icon: <List />, title: t('page.list', { count: summary.items, noun: summary.noun }), hint: t('page.listHint'), action: t('page.listAction'), view: 'list-extractor' }
            : summary.kind === 'product' ? { icon: <ShoppingBag />, title: t('page.product'), hint: summary.name, action: t('page.productAction'), view: 'ai-extract' }
                : summary.kind === 'article'
                    ? ai ? { icon: <FileText />, title: t('page.article'), hint: summary.name, action: t('page.articleAction'), view: 'text-summarizer', secondary: { label: t('page.articleSecondary'), view: 'metadata-extractor' } }
                        : { icon: <FileText />, title: t('page.article'), hint: summary.name, action: t('page.articleSecondary'), view: 'metadata-extractor' }
                    : { icon: <MousePointerClick />, title: web ? t('page.none') : t('page.notWeb'), hint: web ? t('page.noneHint') : undefined, action: t('page.noneAction'), view: 'list-extractor' };
    const found = summary.kind !== 'none';
    return (
        <Card raised={found} className="animate-slide-up">
            <Row align="start" gap={3}>
                <div className={found
                    ? 'flex size-10 shrink-0 -rotate-6 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand text-on-brand [&_svg]:size-5'
                    : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink/7 text-ink-2 [&_svg]:size-5'}>
                    {s.icon}
                </div>
                <div className="min-w-0 flex-1">
                    <Heading size="heading">{s.title}</Heading>
                    {s.hint && <Text size="small" tone="muted" lines={2} className="mt-0.5">{s.hint}</Text>}
                </div>
            </Row>
            {web && (
                <Row gap={1} wrap className="mt-4">
                    <Button variant="primary" onClick={() => onNavigate(s.view)} iconEnd={<ArrowRight />}>{s.action}</Button>
                    {s.secondary && <Button variant="ghost" onClick={() => onNavigate(s.secondary!.view)}>{s.secondary.label}</Button>}
                </Row>
            )}
        </Card>
    );
}

function IntentTile({ icon, title, hint, tone, onClick }: { icon: ReactNode; title: string; hint: string; tone: Tone; onClick: () => void }) {
    return (
        <CardButton tone={tone} pad="sm" onClick={onClick} className="flex flex-col items-start gap-0.5">
            <span className="mb-2 flex size-8 items-center justify-center rounded-lg bg-surface/80 text-ink [&_svg]:size-[17px]">{icon}</span>
            <Text weight="semibold" className="leading-tight">{title}</Text>
            <Text size="caption" tone="muted">{hint}</Text>
        </CardButton>
    );
}

function ToolRow({ icon, title, hint, onClick, iconClass = 'bg-surface-2 text-ink-2' }: { icon: ReactNode; title: string; hint: string; onClick: () => void; iconClass?: string }) {
    return (
        <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-ink/5">
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4 ${iconClass}`}>{icon}</span>
            <span className="min-w-0 flex-1">
                <Text size="small" weight="semibold">{title}</Text>
                <Text size="caption" tone="faint" truncate>{hint}</Text>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-3" />
        </button>
    );
}

function ago(ms: number, t: TFunction<'common'>): string {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return t('time.justNow');
    if (min < 60) return t('time.minutesAgo', { count: min });
    const h = Math.round(min / 60);
    if (h < 24) return t('time.hoursAgo', { count: h });
    return t('time.daysAgo', { count: Math.round(h / 24) });
}

export default function HomePage({ onNavigate, isTabConnected = true }: HomePageProps) {
    const { t } = useTranslation('home');
    const { t: tc } = useTranslation('common');
    const page = usePageTab();
    const summary = usePageSummary(page, isTabConnected);
    const recent = useRecentTables();
    const [more, setMore] = useState(false);
    const ai = useAiReady();
    const aiTools = (hint?: string) => <>
        <ToolRow icon={<MessageSquareText />} iconClass="bg-tile-lilac text-ink" title={t('textSummarizer.title')} hint={hint ?? t('textSummarizer.description')} onClick={() => onNavigate('text-summarizer')} />
        <ToolRow icon={<Sparkles />} iconClass="bg-tile-mint text-ink" title={t('aiExtract.title')} hint={hint ?? t('aiExtract.description')} onClick={() => onNavigate('ai-extract')} />
    </>;

    return (
        <div className="h-full overflow-y-auto bg-bg">
            <Stack gap={5} className="p-4 pb-6">
                <PageStrip page={page} />
                <Suggestion summary={summary} web={page.web} ai={ai === true} onNavigate={onNavigate} />

                <Stack gap={2}>
                    <Heading size="label">{t('intents.title')}</Heading>
                    <div className="grid grid-cols-2 gap-2">
                        <IntentTile tone="lilac" icon={<List />} title={t('intents.list.title')} hint={t('intents.list.hint')} onClick={() => onNavigate('list-extractor')} />
                        <IntentTile tone="sky" icon={<Files />} title={t('intents.pages.title')} hint={t('intents.pages.hint')} onClick={() => onNavigate('page-extractor')} />
                        <IntentTile tone="peach" icon={<ImageIcon />} title={t('intents.images.title')} hint={t('intents.images.hint')} onClick={() => onNavigate('image-downloader')} />
                        <IntentTile tone="butter" icon={<Radar />} title={t('intents.toolkit.title')} hint={t('intents.toolkit.hint')} onClick={() => onNavigate('toolkit')} />
                    </div>
                </Stack>

                {ai && (
                    <Stack gap={1.5}>
                        <Heading size="label" className="flex items-center gap-1.5"><Sparkles size={13} className="text-accent" />{t('ai.title')}</Heading>
                        <Card pad="none" className="p-1">{aiTools()}</Card>
                    </Stack>
                )}

                {recent.length > 0 && (
                    <Stack gap={1.5}>
                        <Row justify="between">
                            <Heading size="label">{t('recent.title')}</Heading>
                            <Button size="sm" variant="ghost" iconEnd={<ChevronRight />} className="-mr-2" onClick={() => onNavigate('history')}>{t('recent.all')}</Button>
                        </Row>
                        <Card pad="none" className="overflow-hidden">
                            {recent.map((table, i) => (
                                <button key={table.id} type="button" onClick={() => openTable(table.id)}
                                    className={`flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left hover:bg-ink/4 ${i ? 'border-t border-line' : ''}`}>
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tile-butter text-ink [&_svg]:size-4"><Table2 /></span>
                                    <span className="min-w-0 flex-1">
                                        <Text size="small" weight="semibold" truncate>{table.name}</Text>
                                        <Text size="caption" tone="faint">{t('recent.rows', { count: table.rowCount })} · {ago(table.updatedAt || table.createdAt, tc)}</Text>
                                    </span>
                                    <ChevronRight size={15} className="shrink-0 text-ink-3" />
                                </button>
                            ))}
                        </Card>
                    </Stack>
                )}

                <Disclosure variant="plain" icon={<Layers />} summary={t('moreTools')} open={more} onToggle={setMore}>
                    <Stack gap={0.5}>
                        <ToolRow icon={<Table2 />} title={t('tables.title')} hint={t('tables.description')} onClick={() => onNavigate('tables')} />
                        <ToolRow icon={<FileText />} title={t('pageMarkdown.title')} hint={t('pageMarkdown.description')} onClick={() => onNavigate('markdown')} />
                        <ToolRow icon={<Mail />} title={t('contacts.title')} hint={t('contacts.description')} onClick={() => onNavigate('email-extractor')} />
                        <ToolRow icon={<Unlock />} title={t('browserUtilities.title')} hint={t('browserUtilities.description')} onClick={() => onNavigate('utilities')} />
                        {ai === false && aiTools(t('ai.needsAi'))}
                    </Stack>
                </Disclosure>
            </Stack>
        </div>
    );
}
