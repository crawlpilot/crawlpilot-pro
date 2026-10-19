/**
 * Home starts from the page you're on (docs/plans/ux-simplification-plan.md §4.2): which page,
 * one suggestion for it ("24 products on this page · Get them as a table"), four plain choices, your
 * recent tables, and the rest of the tools one tap further.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Collapse, Skeleton, Stack, Typography } from '@mui/material';
import {
    ChevronDown, ChevronRight, FileText, Image as ImageIcon, Layers, List, MessageSquareText, MousePointerClick,
    Radar, ShoppingBag, Sparkles, Table2, Unlock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePageTab } from '../hooks/usePageTab';
import PageStrip from '../components/ui/PageStrip';
import { sendToPage } from '../../shared/messages';
import type { PageSummary } from '../../shared/types/pageSummary';
import type { Table } from '../../shared/types/database';
import { db } from '../../shared/db';

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

function openTable(id?: number) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table${id ? `&tableId=${id}` : ''}`) });
}

/** The one thing to do with this page. */
function Suggestion({ summary, web, onNavigate }: { summary: PageSummary | null; web: boolean; onNavigate: (view: string) => void }) {
    const { t } = useTranslation('home');
    if (!summary) {
        return (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '14px', p: 2 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{t('page.checking')}</Typography>
                <Skeleton variant="text" width="70%" height={26} />
                <Skeleton variant="rounded" width={170} height={34} sx={{ mt: 1.25, borderRadius: '8px' }} />
            </Box>
        );
    }
    const s: { icon: ReactNode; title: string; hint?: string; action: string; view: string; secondary?: { label: string; view: string } } =
        summary.kind === 'list' ? { icon: <List size={18} />, title: t('page.list', { count: summary.items, noun: summary.noun }), hint: t('page.listHint'), action: t('page.listAction'), view: 'list-extractor' }
            : summary.kind === 'product' ? { icon: <ShoppingBag size={18} />, title: t('page.product'), hint: summary.name, action: t('page.productAction'), view: 'ai-extract' }
                : summary.kind === 'article' ? { icon: <FileText size={18} />, title: t('page.article'), hint: summary.name, action: t('page.articleAction'), view: 'text-summarizer', secondary: { label: t('page.articleSecondary'), view: 'metadata-extractor' } }
                    : { icon: <MousePointerClick size={18} />, title: web ? t('page.none') : t('page.notWeb'), hint: web ? t('page.noneHint') : undefined, action: t('page.noneAction'), view: 'list-extractor' };
    return (
        <Box sx={{
            borderRadius: '14px', p: 2, border: 1, borderColor: 'rgb(var(--cp-accent-rgb) / 0.35)',
            background: 'linear-gradient(180deg, rgb(var(--cp-accent-rgb) / 0.08) 0%, rgb(var(--cp-accent-rgb) / 0.02) 100%)',
        }}>
            <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                <Box sx={{ color: 'primary.light', display: 'flex', mt: 0.25 }}>{s.icon}</Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3, color: 'text.primary' }}>{s.title}</Typography>
                    {s.hint && <Typography variant="body2" sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.hint}</Typography>}
                </Box>
            </Box>
            {web && (
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button variant="contained" onClick={() => onNavigate(s.view)} endIcon={<ChevronRight size={16} />} sx={{ fontWeight: 700, px: 2 }}>{s.action}</Button>
                    {s.secondary && <Button variant="text" color="inherit" onClick={() => onNavigate(s.secondary!.view)} sx={{ color: 'text.secondary' }}>{s.secondary.label}</Button>}
                </Stack>
            )}
        </Box>
    );
}

function IntentTile({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
    return (
        <ButtonBase onClick={onClick} sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5, p: 1.5, borderRadius: '12px', textAlign: 'left',
            border: 1, borderColor: 'divider', bgcolor: 'background.paper', transition: 'border-color .15s, background-color .15s',
            '&:hover': { borderColor: 'rgb(var(--cp-ink-rgb) / 0.18)', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.03)' },
        }}>
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
            <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.25 }}>{title}</Typography>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', lineHeight: 1.3 }}>{hint}</Typography>
        </ButtonBase>
    );
}

function ToolRow({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
    return (
        <ButtonBase onClick={onClick} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', px: 1.25, py: 1, borderRadius: '10px', textAlign: 'left', '&:hover': { bgcolor: 'rgb(var(--cp-ink-rgb) / 0.04)' } }}>
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600, fontSize: '0.78rem', color: 'text.primary' }}>{title}</Typography>
                <Typography variant="caption" noWrap sx={{ display: 'block', fontSize: '0.68rem' }}>{hint}</Typography>
            </Box>
            <ChevronRight size={15} color="var(--cp-text-3)" />
        </ButtonBase>
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

    return (
        <Box sx={{ height: '100%', overflowY: 'auto', bgcolor: 'background.default' }}>
            <Stack spacing={2} sx={{ p: 2, pb: 3 }}>
                <PageStrip page={page} />
                <Suggestion summary={summary} web={page.web} onNavigate={onNavigate} />

                <Box>
                    <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 600, fontSize: '0.72rem' }}>{t('intents.title')}</Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <IntentTile icon={<List size={18} />} title={t('intents.list.title')} hint={t('intents.list.hint')} onClick={() => onNavigate('list-extractor')} />
                        <IntentTile icon={<Sparkles size={18} />} title={t('intents.details.title')} hint={t('intents.details.hint')} onClick={() => onNavigate('ai-extract')} />
                        <IntentTile icon={<ImageIcon size={18} />} title={t('intents.images.title')} hint={t('intents.images.hint')} onClick={() => onNavigate('image-downloader')} />
                        <IntentTile icon={<MessageSquareText size={18} />} title={t('intents.summary.title')} hint={t('intents.summary.hint')} onClick={() => onNavigate('text-summarizer')} />
                    </Box>
                </Box>

                {recent.length > 0 && (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                            <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, fontSize: '0.72rem' }}>{t('recent.title')}</Typography>
                            <Button size="small" onClick={() => onNavigate('history')} sx={{ fontSize: '0.7rem', minWidth: 0 }}>{t('recent.all')}</Button>
                        </Box>
                        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', overflow: 'hidden' }}>
                            {recent.map((table, i) => (
                                <ButtonBase key={table.id} onClick={() => openTable(table.id)} sx={{
                                    display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', px: 1.5, py: 1, textAlign: 'left',
                                    borderTop: i ? 1 : 0, borderColor: 'divider', '&:hover': { bgcolor: 'rgb(var(--cp-ink-rgb) / 0.03)' },
                                }}>
                                    <Table2 size={15} color="var(--cp-text-2)" />
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 600, color: 'text.primary' }}>{table.name}</Typography>
                                        <Typography variant="caption" sx={{ fontSize: '0.66rem' }}>{t('recent.rows', { count: table.rowCount })} · {ago(table.updatedAt || table.createdAt, tc)}</Typography>
                                    </Box>
                                    <ChevronRight size={15} color="var(--cp-text-3)" />
                                </ButtonBase>
                            ))}
                        </Box>
                    </Box>
                )}

                <Box>
                    <ButtonBase onClick={() => setMore(m => !m)} aria-expanded={more} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5, borderRadius: '6px', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                        <Layers size={14} />
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 600, color: 'inherit' }}>{t('moreTools')}</Typography>
                        <ChevronDown size={14} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                    </ButtonBase>
                    <Collapse in={more}>
                        <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                            <ToolRow icon={<FileText size={17} />} title={t('pageExtractor.title')} hint={t('pageExtractor.description')} onClick={() => onNavigate('page-extractor')} />
                            <ToolRow icon={<Radar size={17} />} title={t('scraperToolkit.title')} hint={t('scraperToolkit.description')} onClick={() => onNavigate('toolkit')} />
                            <ToolRow icon={<Unlock size={17} />} title={t('browserUtilities.title')} hint={t('browserUtilities.description')} onClick={() => onNavigate('utilities')} />
                        </Stack>
                    </Collapse>
                </Box>
            </Stack>
        </Box>
    );
}
