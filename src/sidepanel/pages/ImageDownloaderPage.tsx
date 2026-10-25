import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToolHeader from '../components/ui/ToolHeader';
import { Badge, Button, Chip, Collapse, IconButton, Menu, MenuItem, Progress, Select, Spinner, Stack, Switch, Text, TextField } from '../ui';
import {
    ArrowDownToLine, CheckSquare, Copy, Database, Download, Filter, Image as ImageIcon,
    Maximize2, MoreVertical, Radio, RefreshCw, Search, Square,
} from 'lucide-react';
import type { FoundImage } from '../../shared/images/types';
import { sendToTab } from '../../shared/messages';
import { db } from '../../shared/db';
import { useImageScan } from '../hooks/useImageScan';
import { useImageSave } from '../hooks/useImageSave';
import { useFullSize } from '../hooks/useFullSize';
import { useImageFilters } from '../hooks/useImageFilters';
import { useLookalikes } from '../hooks/useLookalikes';
import { foldDuplicates } from '../../shared/images/dedupe';
import { domainCounts, filterImages, groupImages, savedSrc, sortImages, type GroupBy, type SortBy } from '../components/images/imageFilters';
import { ImageCard } from '../components/images/ImageCard';
import { ImageLightbox } from '../components/images/ImageLightbox';
import { FiltersPanel } from '../components/images/FiltersPanel';
import { SaveOptions } from '../components/images/SaveOptions';
import { SaveReportCard, megabytes } from '../components/images/SaveReportCard';
import { browserDeps } from '../services/images/save';
import { copyImageToClipboard } from '../services/images/clipboard';
import { imageTable } from '../services/images/imageTable';

const PAGE_SIZE = 200;
const CARD_KEY = 'crawlpilot.images.cardSize';
const FOLD_KEY = 'crawlpilot.images.fold';

function siteOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));

export default function ImageDownloaderPage({ onBack }: { onBack: () => void }) {
    const { t } = useTranslation('imageDownloader');
    const { images, page, scanning, progress, liveWatching, error, quickScan, deepScan, cancelScan, toggleLiveWatch } = useImageScan();
    const saver = useImageSave(page.tabId, page.title);
    const fullSize = useFullSize(images);
    const site = siteOf(images[0]?.pageUrl ?? '');
    const { filters, update, toggle, reset } = useImageFilters(site);
    const lookalikes = useLookalikes(page.tabId);
    const [fold, setFoldState] = useState(() => { try { return localStorage.getItem(FOLD_KEY) !== 'off'; } catch { return true; } });
    const setFold = (on: boolean) => { setFoldState(on); try { localStorage.setItem(FOLD_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [showFilters, setShowFilters] = useState(false);
    const [sortBy, setSortBy] = useState<SortBy>('page');
    const [groupBy, setGroupBy] = useState<GroupBy | 'none'>('none');
    const [activeGroup, setActiveGroup] = useState<string | null>(null);
    const [preview, setPreview] = useState<number | null>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [cardSize, setCardSize] = useState(() => { try { return Number(localStorage.getItem(CARD_KEY)) || 110; } catch { return 110; } });
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const lastClicked = useRef<number | null>(null);

    const scanInit = useRef(false);
    useEffect(() => {
        if (scanInit.current) return;
        scanInit.current = true;
        void quickScan();
    }, [quickScan]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const sized = useMemo(() => fullSize.apply(images), [images, fullSize.enabled, fullSize.found]);
    const folded = useMemo(() => (fold ? foldDuplicates(sized, lookalikes.hashes) : sized), [sized, fold, lookalikes.hashes]);
    const foldedAway = sized.length - folded.length;
    const filtered = useMemo(() => sortImages(filterImages(folded, filters), sortBy), [folded, filters, sortBy]);
    const groups = useMemo(() => (groupBy === 'none' ? [] : groupImages(filtered, groupBy)), [filtered, groupBy]);
    const shown = useMemo(() => {
        if (groupBy === 'none' || activeGroup === null) return filtered;
        return groups.find(g => g.label === activeGroup)?.images ?? [];
    }, [filtered, groups, groupBy, activeGroup]);
    const domains = useMemo(() => domainCounts(sized), [sized]);
    const selectedImages = useMemo(() => filtered.filter(i => selected.has(i.src)), [filtered, selected]);

    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [shown]);
    useEffect(() => { try { localStorage.setItem(CARD_KEY, String(cardSize)); } catch { /* storage blocked */ } }, [cardSize]);

    const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(n => (n === text ? null : n)), 3000); };

    const select = (index: number, e: React.MouseEvent) => {
        const img = shown[index];
        // Read now: the updater can run after lastClicked has moved to this card.
        const last = e.shiftKey ? lastClicked.current : null;
        setSelected(prev => {
            const next = new Set(prev);
            if (last !== null) {
                const [from, to] = [Math.min(last, index), Math.max(last, index)];
                const on = !prev.has(img.src);
                for (const i of shown.slice(from, to + 1)) { if (on) next.add(i.src); else next.delete(i.src); }
            } else if (next.has(img.src)) next.delete(img.src);
            else next.add(img.src);
            return next;
        });
        lastClicked.current = index;
    };
    const selectAll = useCallback(() => setSelected(new Set(shown.map(i => i.src))), [shown]);
    const clearSelection = useCallback(() => { setSelected(new Set()); lastClicked.current = null; }, []);

    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (typing(e) || preview !== null) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); selectAll(); }
            if (e.key === 'Escape') clearSelection();
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [preview, selectAll, clearSelection]);

    const copyUrls = async (list: FoundImage[]) => {
        await navigator.clipboard.writeText(list.map(savedSrc).filter(u => !u.startsWith('data:')).join('\n'));
        flash(t('copiedUrls', { count: list.length }));
    };

    const saveToData = async (list: FoundImage[]) => {
        const pageUrl = list[0]?.pageUrl ?? '';
        const id = await db.tables.save(imageTable(list, pageUrl), { name: t('tableName', { page: page.title || site }) });
        chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) });
    };

    const showOnPage = async (img: FoundImage): Promise<string | null> => {
        if (page.tabId === null) return t('noPage');
        const reply = await sendToTab(page.tabId, 'SHOW_IMAGE', { src: img.src }).catch(e => ({ success: false as const, error: String(e) }));
        if (!reply.success) return reply.error;
        await chrome.tabs.update(page.tabId, { active: true });
        return null;
    };

    const copyImage = async (img: FoundImage): Promise<string | null> => {
        try {
            await copyImageToClipboard(() => browserDeps(page.tabId).fetch(savedSrc(img), new AbortController().signal));
            return null;
        } catch (e) {
            return t('copyFailedImage', { reason: (e as Error)?.message || String(e) });
        }
    };

    const downloading = saver.progress !== null;
    const allSelected = shown.length > 0 && shown.every(i => selected.has(i.src));
    const statusText = scanning === 'quick' ? t('reading')
        : scanning === 'deep' ? t('scanning', { progress })
            : liveWatching ? t('liveWatching')
                : lookalikes.progress ? t('comparing', { done: lookalikes.progress.done, total: lookalikes.progress.total })
                    : t('imagesCount', { filtered: filtered.length, total: images.length }) + (foldedAway > 0 ? ` · ${t('duplicatesFolded', { count: foldedAway })}` : '');

    const bar = selected.size > 0 || scanning === 'deep' || downloading || !!notice;

    return (
        <div className="relative flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={t('title')} subtitle={statusText} onBack={onBack} actions={<>
                    <IconButton label={t('deepScan')} onClick={() => void deepScan()} disabled={!!scanning}><ArrowDownToLine /></IconButton>
                    <IconButton label={liveWatching ? t('stopWatching') : t('liveWatch')} active={liveWatching} onClick={toggleLiveWatch}><Radio /></IconButton>
                    <IconButton label={t('rescan')} onClick={() => { clearSelection(); void quickScan(); }} disabled={!!scanning}>
                        <RefreshCw className={scanning === 'quick' ? 'animate-spin' : ''} />
                    </IconButton>
                    <IconButton label={t('more')} onClick={e => setMenu(e.currentTarget)}><MoreVertical /></IconButton>
                    <Menu anchor={menu} onClose={() => setMenu(null)} align="end">
                        <MenuItem disabled={!filtered.length} onClick={() => { setMenu(null); void copyUrls(filtered); }}>{t('copyAllUrls', { count: filtered.length })}</MenuItem>
                        <MenuItem disabled={!filtered.length} onClick={() => { setMenu(null); void saveToData(filtered); }}>{t('saveAllToData', { count: filtered.length })}</MenuItem>
                        <MenuItem disabled={!sized.length || !!lookalikes.progress} onClick={() => { setMenu(null); setFold(true); void lookalikes.run(sized); }}>
                            <span className="block">{t('findLookalikes')}</span>
                            <span className="block text-caption whitespace-normal text-ink-3">{t('findLookalikesHint')}</span>
                        </MenuItem>
                        {page.tabId !== null && !new URLSearchParams(window.location.search).get('tabId') && (
                            <MenuItem onClick={() => { setMenu(null); chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=image-downloader&tabId=${page.tabId}`) }); }}>
                                {t('openInTab')}
                            </MenuItem>
                        )}
                    </Menu>
                </>}>
                <div className="mt-3 flex flex-col gap-2">
                    {error && <Text size="caption" tone="warning">{error}</Text>}
                    {lookalikes.progress && <Progress size="sm" value={lookalikes.progress.done / lookalikes.progress.total * 100} label={t('findLookalikes')} />}
                    {scanning && <Progress size="sm" value={scanning === 'quick' ? undefined : progress} label={statusText} />}

                    <div className="flex items-center gap-1.5">
                        <TextField size="sm" className="flex-1" placeholder={t('search')} aria-label={t('search')} value={filters.searchQuery}
                            onChange={e => update('searchQuery', e.target.value)} start={<Search />} />
                        <IconButton variant="secondary" label={t('filters')} active={showFilters} onClick={() => setShowFilters(s => !s)}><Filter /></IconButton>
                        <IconButton variant="secondary" label={allSelected ? t('deselectAll') : t('selectAll')} onClick={allSelected ? clearSelection : selectAll}>
                            {selected.size > 0 ? <CheckSquare /> : <Square />}
                        </IconButton>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select size="sm" aria-label={t('sort')} value={sortBy} onChange={(v: SortBy) => setSortBy(v)}
                            options={(['page', 'largest', 'smallest', 'type'] as const).map(s => ({ value: s, label: t(`sortBy.${s}`) }))} />
                        <Select size="sm" aria-label={t('group')} value={groupBy} onChange={(v: GroupBy | 'none') => { setGroupBy(v); setActiveGroup(null); }}
                            options={(['none', 'size', 'section', 'domain'] as const).map(g => ({ value: g, label: t(`groupBy.${g}`) }))} />
                        <label className="flex min-w-[60px] flex-1 items-center gap-1.5 px-1 text-ink-3" title={t('cardSize')}>
                            <ImageIcon size={12} className="shrink-0" />
                            <input type="range" min={70} max={260} step={10} value={cardSize} onChange={e => setCardSize(Number(e.target.value))} aria-label={t('cardSize')}
                                className="cp-range h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink/10" />
                            <Maximize2 size={12} className="shrink-0" />
                        </label>
                    </div>

                    <Collapse open={showFilters}>
                        {/* Scrolls on its own, so the save options at its end stay reachable in a short side panel. */}
                        <div className="max-h-[55vh] overflow-y-auto pr-1">
                            <FiltersPanel filters={filters} update={update} toggle={toggle} reset={reset} domains={domains}>
                                <Switch checked={fullSize.enabled} onChange={fullSize.setEnabled} label={t('fullSize')}
                                    hint={fullSize.pending > 0 ? t('fullSizeSearching', { found: fullSize.found, pending: fullSize.pending }) : t('fullSizeFound', { count: fullSize.found })} />
                                <Switch checked={fold} onChange={setFold} label={t('foldDuplicates')} />
                                <SaveOptions mode={saver.mode} onMode={saver.setMode} template={saver.template} onTemplate={saver.setTemplate} manifest={saver.manifest} onManifest={saver.setManifest}
                                    processing={saver.processing} onProcessing={saver.setProcessing} />
                            </FiltersPanel>
                        </div>
                    </Collapse>
                </div>
            </ToolHeader>

            <div className="flex-1 overflow-y-auto p-3 pb-20">
                {saver.report && <SaveReportCard report={saver.report} onRetry={saver.retryFailed} onDismiss={saver.dismiss} />}
                {filtered.length === 0 && !scanning ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-tile-peach text-ink shadow-press"><ImageIcon size={26} /></span>
                        <div>
                            <Text weight="semibold">{t('noImagesFound')}</Text>
                            <Text size="caption" tone="muted">{images.length > 0 ? t('tryAdjustFilters') : t('navigateAndScan')}</Text>
                        </div>
                        <div className="flex gap-2">
                            {images.length > 0 && <Button size="sm" onClick={reset}>{t('resetFilters')}</Button>}
                            <Button size="sm" variant="primary" icon={<Search />} onClick={() => void (images.length ? deepScan() : quickScan())}>
                                {images.length ? t('deepScanShort') : t('scanPage')}
                            </Button>
                        </div>
                    </div>
                ) : groupBy !== 'none' && activeGroup === null ? (
                    <Stack gap={2}>
                        <Text size="caption" weight="semibold" tone="muted" className="px-1">{t('groupCount', { count: groups.length })}</Text>
                        {groups.map(group => (
                            <div key={group.label} onClick={() => setActiveGroup(group.label)}
                                className="flex cursor-pointer items-center gap-3 rounded-card border border-line bg-surface p-3 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-press">
                                <div className="flex shrink-0 gap-0.5">
                                    {group.images.slice(0, 3).map(img => (
                                        <div key={img.src} className="size-9 overflow-hidden rounded-md bg-surface-2">
                                            <img src={img.src} alt="" className="size-full object-cover" loading="lazy" />
                                        </div>
                                    ))}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <Text size="small" weight="bold" truncate>{group.label}</Text>
                                    <Text size="caption" tone="muted">{t('imagesInGroup', { count: group.images.length })}</Text>
                                </div>
                                <IconButton size="sm" label={t('downloadGroup')} disabled={downloading} onClick={e => { e.stopPropagation(); void saver.save(group.images); }}><Download /></IconButton>
                            </div>
                        ))}
                    </Stack>
                ) : (
                    <div>
                        {groupBy !== 'none' && activeGroup !== null && (
                            <div className="mb-3 flex items-center gap-2 px-1">
                                <Chip size="md" tone="brand" className="max-w-[220px]" onRemove={() => setActiveGroup(null)}>{activeGroup}</Chip>
                                <Text size="caption" tone="muted">{t('imagesInGroup', { count: shown.length })}</Text>
                                <Button size="sm" variant="ghost" onClick={selectAll}>{t('selectAll')}</Button>
                            </div>
                        )}
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>
                            {shown.slice(0, visibleCount).map((img, i) => (
                                <ImageCard key={img.src} img={img} selected={selected.has(img.src)}
                                    onSelect={e => select(i, e)} onPreview={() => setPreview(i)} onDownload={() => void saver.save([img], 'folder')} />
                            ))}
                        </div>
                        {visibleCount < shown.length && (
                            <div className="mt-3 flex justify-center">
                                <Button size="sm" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>{t('showMore', { count: shown.length - visibleCount })}</Button>
                            </div>
                        )}
                    </div>
                )}
                {scanning && filtered.length > 0 && (
                    <div className="flex items-center justify-center gap-2 py-4 text-ink-2">
                        <Spinner size={14} />
                        <Text size="caption" tone="muted">{t('discoveringMore')}</Text>
                    </div>
                )}
            </div>

            {preview !== null && (
                <ImageLightbox images={shown} index={preview} onIndex={setPreview} onClose={() => setPreview(null)}
                    onShowOnPage={showOnPage} onDownload={img => void saver.save([img], 'folder')} onCopyImage={copyImage} />
            )}

            {bar && (
                <div className="absolute inset-x-3 bottom-3 z-30 flex items-center justify-between gap-2 rounded-2xl border-[1.5px] border-line-strong bg-surface px-3 py-2 shadow-press animate-slide-up">
                    {saver.progress ? (
                        <>
                            <div className="flex min-w-0 items-center gap-2">
                                <Spinner size={14} />
                                <Text size="caption" weight="semibold" truncate>
                                    {t('saving', { done: saver.progress.done + saver.progress.failed, total: saver.progress.total, size: megabytes(saver.progress.bytes) })}
                                    {saver.progress.failed > 0 && ` · ${t('failedCount', { count: saver.progress.failed })}`}
                                </Text>
                            </div>
                            <Button size="sm" variant="danger" onClick={saver.stop}>{t('stop')}</Button>
                        </>
                    ) : scanning === 'deep' ? (
                        <>
                            <div className="flex items-center gap-2">
                                <Spinner size={14} />
                                <Text size="caption" weight="semibold">{`${progress}%`}</Text>
                            </div>
                            <Button size="sm" variant="danger" onClick={cancelScan}>{t('cancelScan')}</Button>
                        </>
                    ) : selected.size > 0 ? (
                        <>
                            <div className="flex items-center gap-1.5">
                                <Badge>{selected.size}</Badge>
                                <Text size="caption" weight="semibold" tone="muted">{t('selected')}</Text>
                            </div>
                            <div className="flex items-center gap-0.5">
                                <Button size="sm" variant="ghost" onClick={clearSelection}>{t('clear')}</Button>
                                <IconButton size="sm" label={t('copyUrls')} onClick={() => void copyUrls(selectedImages)}><Copy /></IconButton>
                                <IconButton size="sm" label={t('saveToData')} onClick={() => void saveToData(selectedImages)}><Database /></IconButton>
                                <Button size="sm" variant="primary" icon={<Download />} onClick={() => void saver.save(selectedImages)}>{t('downloadSelected')}</Button>
                            </div>
                        </>
                    ) : (
                        <Text size="caption" weight="semibold">{notice}</Text>
                    )}
                </div>
            )}

            {filtered.length > 0 && !bar && !scanning && (
                <Button variant="primary" icon={<Download />} onClick={() => void saver.save(filtered)} className="absolute right-4 bottom-4 z-20 animate-pop">
                    {t('downloadAll', { count: filtered.length })}
                </Button>
            )}
        </div>
    );
}
