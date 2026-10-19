/**
 * The list's happy path in one card (docs/plans/ux-simplification-plan.md §4.3): what was found, a
 * few rows of it, how more pages will load (found on the page, stated as a sentence), and one button.
 * The Pages and Settings steps stay one tap away for anyone who wants to change them.
 */
import { Box, Button, MenuItem, Select, Skeleton, Stack, Typography } from '@mui/material';
import { ChevronRight, ExternalLink, Play, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ListPick, PaginationMode } from '../../../shared/types/extraction';

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

    const pageSelect = (
        <Select size="small" variant="standard" value={maxPages} onChange={e => onMaxPages(Number(e.target.value))} disableUnderline
            sx={{ mx: 0.5, fontSize: 'inherit', fontWeight: 700, color: 'primary.light', '& .MuiSelect-select': { py: 0, pr: '18px !important' } }}>
            {PAGE_CHOICES.map(n => <MenuItem key={n} value={n} sx={{ fontSize: '0.8rem' }}>{n}</MenuItem>)}
        </Select>
    );

    return (
        <Box sx={{ border: 1, borderColor: 'rgb(var(--cp-accent-rgb) / 0.4)', borderRadius: '14px', overflow: 'hidden', background: 'linear-gradient(180deg, rgb(var(--cp-accent-rgb) / 0.07) 0%, rgb(var(--cp-accent-rgb) / 0.01) 100%)' }}>
            <Box sx={{ p: 1.75, pb: 1.25 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: 'text.primary' }}>
                    {t('quick.found', { count: pick.count })}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: '0.72rem' }}>{t('quick.details', { count: fieldCount })}</Typography>
            </Box>

            {columns.length > 0 && rows.length > 0 && (
                <Box sx={{ mx: 1.75, mb: 1.25, border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.05)' }}>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.68rem' }}>
                        <thead>
                            <tr>{columns.map(c => (
                                <Box component="th" key={c.id} sx={{ textAlign: 'left', px: 0.75, py: 0.5, color: 'text.secondary', fontWeight: 600, borderBottom: 1, borderColor: 'divider', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Box>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={i}>{columns.map(c => (
                                    <Box component="td" key={c.id} sx={{ px: 0.75, py: 0.5, color: 'text.primary', borderTop: i ? 1 : 0, borderColor: 'divider', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r[c.id] ?? '')}</Box>
                                ))}</tr>
                            ))}
                        </tbody>
                    </Box>
                    {onOpenPreview && (
                        <Button size="small" onClick={onOpenPreview} endIcon={<ExternalLink size={12} />} sx={{ width: '100%', borderRadius: 0, borderTop: 1, borderColor: 'divider', fontSize: '0.66rem', py: 0.25 }}>
                            {t('quick.openPreview')}
                        </Button>
                    )}
                </Box>
            )}

            <Box sx={{ px: 1.75, pb: 1.75 }}>
                <Typography component="div" variant="body2" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', mb: 1.25, color: 'text.secondary' }}>
                    {pages === undefined ? <Skeleton width="70%" />
                        : pages === null ? t('quick.onePage')
                            : pages.mode === 'loadMore'
                                ? <>{t('quick.loadMoreBefore', { label: pages.label })}{pageSelect}{t('quick.loadMoreAfter')}</>
                                : <>{t('quick.nextBefore', { label: pages.label })}{pageSelect}{t('quick.nextAfter')}</>}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                    <Button variant="contained" onClick={onRun} disabled={busy || pages === undefined} startIcon={<Play size={15} />} sx={{ fontWeight: 700, flex: 1 }}>
                        {multi ? t('quick.runPages', { count: maxPages }) : t('quick.runOne', { count: pick.count })}
                    </Button>
                    <Button variant="text" color="inherit" onClick={onCustomize} startIcon={<SlidersHorizontal size={14} />} endIcon={<ChevronRight size={14} />} sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {t('quick.customize')}
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}
