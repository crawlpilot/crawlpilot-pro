/** One thing in My data: a saved table (or a run without one yet), its status, and what to do with it. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Chip, IconButton, Menu, MenuItem, Text, Tooltip, type ChipTone } from '../../ui';
import { Download, Info, MoreVertical, RefreshCcw, Square, Table2, Trash2 } from 'lucide-react';
import type { DataEntry, DataStatus } from './myData';

const STATUS: Record<DataStatus, ChipTone> = { ready: 'success', running: 'info', stopped: 'warning', failed: 'danger' };

export function ago(ms: number, tc: TFunction<'common'>): string {
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
    const hasTable = !!entry.table && entry.rows > 0;

    return (
        <div className="rounded-card border border-line bg-surface p-3.5 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-press">
            <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-butter text-ink"><Table2 size={17} /></span>
                <div className="min-w-0 flex-1">
                    <Text weight="semibold" truncate title={entry.name}>{entry.name || t('untitledJob')}</Text>
                    <Text size="caption" tone="faint" truncate>
                        {entry.site || t('unknownSite')} · {entry.status === 'running' ? t('runningRows', { count: entry.rows }) : t('rows', { count: entry.rows })} · {ago(entry.when, tc)}
                    </Text>
                </div>
                {entry.status !== 'ready' && <Chip tone={STATUS[entry.status]}>{t(`status.${entry.status}`)}</Chip>}
                <IconButton size="sm" label={t('more')} onClick={e => setMenu(e.currentTarget)} className="-mt-0.5 -mr-1.5"><MoreVertical /></IconButton>
            </div>

            {entry.status === 'failed' && !hasTable && (
                <Text size="caption" tone="danger" className="mt-2 ml-12">{t('failedHint')}</Text>
            )}

            <div className="mt-3 ml-12 flex flex-wrap gap-1.5">
                {hasTable && <Button size="sm" variant="primary" onClick={onOpen}>{t('open')}</Button>}
                {hasTable && (
                    <Button size="sm" icon={<Download />} loading={downloading}
                        onClick={async () => { setDownloading(true); try { await onDownload(); } finally { setDownloading(false); } }}>
                        {t('download')}
                    </Button>
                )}
                {entry.status === 'running' && onStop && <Button size="sm" variant="danger" icon={<Square />} onClick={onStop}>{tc('stop')}</Button>}
                {entry.status !== 'running' && onRerun && (
                    <Tooltip title={busy ? tc('loading') : ''}>
                        <span><Button size="sm" variant="ghost" disabled={busy} icon={<RefreshCcw />} onClick={onRerun}>{t('rerun')}</Button></span>
                    </Tooltip>
                )}
            </div>

            <Menu anchor={menu} onClose={() => setMenu(null)} align="end">
                {onDetails && <MenuItem icon={<Info />} onClick={() => { setMenu(null); onDetails(); }}>{t('details')}</MenuItem>}
                <MenuItem icon={<Trash2 />} danger onClick={() => { setMenu(null); onRemove(); }}>{t('remove')}</MenuItem>
            </Menu>
        </div>
    );
}
