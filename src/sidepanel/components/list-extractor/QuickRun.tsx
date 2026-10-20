/**
 * The list's happy path in one card (docs/plans/ux-simplification-plan.md §4.3): what was found, a
 * few rows of it, how more pages will load (found on the page, stated as a sentence), and one button.
 * The Pages and Settings steps stay one tap away for anyone who wants to change them.
 */
import { ChevronRight, ExternalLink, Play, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ListPick, PaginationMode } from '../../../shared/types/extraction';
import { Button, Card, Heading, Row, Select, Skeleton, Text } from '../../ui';

const PREVIEW_ROWS = 3;
const PREVIEW_COLUMNS = 3;
export const PAGE_CHOICES = [1, 3, 5, 10, 25, 50];

interface QuickRunProps {
    pick: ListPick;
    /** How more items load: undefined while the page is checked, null when it has no Next control. */
    pages: { mode: PaginationMode; label: string } | null | undefined;
    maxPages: number;
    onMaxPages: (n: number) => void;
    onRun: () => void;
    onCustomize: () => void;
    onOpenPreview?: () => void;
    busy?: boolean;
}

export function QuickRun({ pick, pages, maxPages, onMaxPages, onRun, onCustomize, onOpenPreview, busy }: QuickRunProps) {
    const { t } = useTranslation('listExtractor');
    const columns: { id: string; name: string }[] = (pick.data?.columns ?? []).filter((c: any) => c.type !== 'image' && c.type !== 'url').slice(0, PREVIEW_COLUMNS);
    const rows: Record<string, unknown>[] = (pick.data?.items ?? []).slice(0, PREVIEW_ROWS);
    const fieldCount = pick.data?.columns?.length ?? 0;
    const multi = !!pages && maxPages > 1;

    const pageSelect = <Select inline aria-label="Pages" value={maxPages} onChange={onMaxPages} options={PAGE_CHOICES.map(n => ({ value: n, label: String(n) }))} />;

    return (
        <Card raised pad="none" className="overflow-hidden animate-slide-up">
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
                <span className="mt-0.5 flex shrink-0 -rotate-6 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand px-2 py-1 font-display text-lead font-extrabold text-on-brand tabular-nums">
                    {pick.count}
                </span>
                <div className="min-w-0">
                    <Heading size="heading">{t('quick.found', { count: pick.count })}</Heading>
                    <Text size="caption" tone="muted">{t('quick.details', { count: fieldCount })}</Text>
                </div>
            </div>

            {columns.length > 0 && rows.length > 0 && (
                <div className="mx-4 mb-3 overflow-hidden rounded-field border border-line bg-surface-2/60">
                    <table className="w-full table-fixed border-collapse text-caption">
                        <thead>
                            <tr>{columns.map(c => (
                                <th key={c.id} className="truncate border-b border-line px-2.5 py-1.5 text-left font-semibold text-ink-2">{c.name}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={i}>{columns.map(c => (
                                    <td key={c.id} className={`truncate px-2.5 py-1.5 text-ink ${i ? 'border-t border-line' : ''}`}>{String(r[c.id] ?? '')}</td>
                                ))}</tr>
                            ))}
                        </tbody>
                    </table>
                    {onOpenPreview && (
                        <button type="button" onClick={onOpenPreview}
                            className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-line py-1.5 text-caption font-semibold text-ink-2 hover:bg-ink/5 hover:text-ink">
                            {t('quick.openPreview')} <ExternalLink size={12} />
                        </button>
                    )}
                </div>
            )}

            <div className="px-4 pb-4">
                <div className="mb-3 flex flex-wrap items-center text-small text-ink-2">
                    {pages === undefined ? <Skeleton className="h-4 w-3/4" />
                        : pages === null ? t('quick.onePage')
                            : pages.mode === 'urls'
                                ? <>{t('quick.urlsBefore')}{pageSelect}{t('quick.urlsAfter')}</>
                            : pages.mode === 'loadMore'
                                ? <>{t('quick.loadMoreBefore', { label: pages.label })}{pageSelect}{t('quick.loadMoreAfter')}</>
                                : <>{t('quick.nextBefore', { label: pages.label })}{pageSelect}{t('quick.nextAfter')}</>}
                </div>
                <Row gap={1}>
                    <Button variant="primary" className="flex-1" onClick={onRun} disabled={busy || pages === undefined} icon={<Play />}>
                        {multi ? t('quick.runPages', { count: maxPages }) : t('quick.runOne', { count: pick.count })}
                    </Button>
                    <Button variant="ghost" onClick={onCustomize} icon={<SlidersHorizontal />} iconEnd={<ChevronRight />}>
                        {t('quick.customize')}
                    </Button>
                </Row>
            </div>
        </Card>
    );
}
