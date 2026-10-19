/** One thing in My data: a saved table (or a run without one yet), its status, and what to do with it. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box, Button, Chip, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { Download, Info, MoreVertical, RefreshCcw, Square, Table2, Trash2 } from 'lucide-react';
import type { DataEntry, DataStatus } from './myData';

const STATUS: Record<DataStatus, { color: string; bg: string }> = {
    ready: { color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
    running: { color: 'var(--cp-accent)', bg: 'rgb(var(--cp-accent-rgb) / 0.12)' },
    stopped: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
    failed: { color: '#F43F5E', bg: 'rgba(244,63,94,0.12)' },
};

function ago(ms: number, tc: TFunction<'common'>): string {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return tc('time.justNow');
    if (min < 60) return tc('time.minutesAgo', { count: min });
    const h = Math.floor(min / 60);
    if (h < 24) return tc('time.hoursAgo', { count: h });
    const days = Math.floor(h / 24);
    return days === 1 ? tc('time.yesterday') : tc('time.daysAgo', { count: days });
}

interface Props {
    entry: DataEntry;
    /** Another run is going: running again waits. */
    busy: boolean;
    onOpen: () => void;
    onDownload: () => Promise<void>;
    onRerun?: () => void;
    onStop?: () => void;
    onDetails?: () => void;
    onRemove: () => void;
}

export function DataCard({ entry, busy, onOpen, onDownload, onRerun, onStop, onDetails, onRemove }: Props) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [downloading, setDownloading] = useState(false);
    const s = STATUS[entry.status];
    const hasTable = !!entry.table && entry.rows > 0;

    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', bgcolor: 'background.paper', p: 1.5, '&:hover': { borderColor: 'rgb(var(--cp-ink-rgb) / 0.14)' } }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                <Box sx={{ mt: 0.25, color: 'text.secondary', display: 'flex' }}><Table2 size={18} /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.82rem', color: 'text.primary' }} title={entry.name}>{entry.name || t('untitledJob')}</Typography>
                    <Typography variant="caption" noWrap sx={{ display: 'block', fontSize: '0.7rem' }}>
                        {entry.site || t('unknownSite')} · {entry.status === 'running' ? t('runningRows', { count: entry.rows }) : t('rows', { count: entry.rows })} · {ago(entry.when, tc)}
                    </Typography>
                </Box>
                {entry.status !== 'ready' && (
                    <Chip size="small" label={t(`status.${entry.status}`)} sx={{ height: 20, fontSize: '0.64rem', fontWeight: 700, color: s.color, bgcolor: s.bg }} />
                )}
                <IconButton size="small" aria-label={t('more')} onClick={e => setMenu(e.currentTarget)} sx={{ mt: -0.5, mr: -0.75, color: 'text.secondary' }}>
                    <MoreVertical size={16} />
                </IconButton>
            </Box>

            {entry.status === 'failed' && !hasTable && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.75, ml: 3.75, color: 'error.light', fontSize: '0.7rem' }}>{t('failedHint')}</Typography>
            )}

            <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, ml: 3.75 }}>
                {hasTable && <Button size="small" variant="contained" onClick={onOpen} sx={{ px: 1.5 }}>{t('open')}</Button>}
                {hasTable && (
                    <Button size="small" variant="outlined" color="inherit" disabled={downloading} startIcon={<Download size={13} />}
                        onClick={async () => { setDownloading(true); try { await onDownload(); } finally { setDownloading(false); } }}
                        sx={{ borderColor: 'divider', color: 'text.secondary' }}>{t('download')}</Button>
                )}
                {entry.status === 'running' && onStop && (
                    <Button size="small" variant="outlined" color="error" startIcon={<Square size={12} />} onClick={onStop}>{tc('stop')}</Button>
                )}
                {entry.status !== 'running' && onRerun && (
                    <Tooltip title={busy ? tc('loading') : ''}>
                        <span>
                            <Button size="small" variant="text" color="inherit" disabled={busy} startIcon={<RefreshCcw size={13} />} onClick={onRerun} sx={{ color: 'text.secondary' }}>{t('rerun')}</Button>
                        </span>
                    </Tooltip>
                )}
            </Stack>

            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                {onDetails && (
                    <MenuItem onClick={() => { setMenu(null); onDetails(); }}>
                        <ListItemIcon><Info size={15} /></ListItemIcon><ListItemText>{t('details')}</ListItemText>
                    </MenuItem>
                )}
                <MenuItem onClick={() => { setMenu(null); onRemove(); }} sx={{ color: 'error.main' }}>
                    <ListItemIcon sx={{ color: 'inherit' }}><Trash2 size={15} /></ListItemIcon><ListItemText>{t('remove')}</ListItemText>
                </MenuItem>
            </Menu>
        </Box>
    );
}
