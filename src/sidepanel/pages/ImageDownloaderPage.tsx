import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToolHeader from '../components/ui/ToolHeader';
import {
    Box, Button, Chip, Collapse, Fade, FormControlLabel, IconButton, InputAdornment, LinearProgress, ListItemText, Menu, MenuItem,
    Paper, Select, Slider, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
    ArrowDownToLine, CheckSquare, Copy, Database, Download, Filter, Image as ImageIcon, Loader,
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
const iconButton = { color: 'text.secondary', bgcolor: 'action.hover', '&:hover': { bgcolor: 'action.selected', color: 'primary.main' } } as const;

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
        setSelected(prev => {
            const next = new Set(prev);
            if (e.shiftKey && lastClicked.current !== null) {
                const [from, to] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
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

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden', position: 'relative' }}>
            <ToolHeader title={t('title')} subtitle={statusText} onBack={onBack} actions={<>
                    <Stack direction="row" spacing={0.5}>
                        <Tooltip title={t('deepScan')}>
                            <span><IconButton onClick={() => void deepScan()} disabled={!!scanning} size="small" sx={iconButton}><ArrowDownToLine size={18} /></IconButton></span>
                        </Tooltip>
                        <Tooltip title={liveWatching ? t('stopWatching') : t('liveWatch')}>
                            <IconButton onClick={toggleLiveWatch} size="small" sx={{ ...iconButton, ...(liveWatching ? { color: 'primary.main', bgcolor: 'action.selected' } : {}) }}><Radio size={18} /></IconButton>
                        </Tooltip>
                        <Tooltip title={t('rescan')}>
                            <span><IconButton onClick={() => { clearSelection(); void quickScan(); }} disabled={!!scanning} size="small" sx={iconButton}><RefreshCw size={18} className={scanning === 'quick' ? 'animate-spin' : ''} /></IconButton></span>
                        </Tooltip>
                        <IconButton size="small" sx={iconButton} onClick={e => setMenu(e.currentTarget)} aria-label={t('more')}><MoreVertical size={18} /></IconButton>
                    </Stack>
                    <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                        <MenuItem disabled={!filtered.length} onClick={() => { setMenu(null); void copyUrls(filtered); }}><ListItemText>{t('copyAllUrls', { count: filtered.length })}</ListItemText></MenuItem>
                        <MenuItem disabled={!filtered.length} onClick={() => { setMenu(null); void saveToData(filtered); }}><ListItemText>{t('saveAllToData', { count: filtered.length })}</ListItemText></MenuItem>
                        <MenuItem disabled={!sized.length || !!lookalikes.progress} onClick={() => { setMenu(null); setFold(true); void lookalikes.run(sized); }}>
                            <ListItemText primary={t('findLookalikes')} secondary={t('findLookalikesHint')} secondaryTypographyProps={{ fontSize: '0.65rem' }} />
                        </MenuItem>
                        {page.tabId !== null && !new URLSearchParams(window.location.search).get('tabId') && (
                            <MenuItem onClick={() => { setMenu(null); chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=image-downloader&tabId=${page.tabId}`) }); }}>
                                <ListItemText>{t('openInTab')}</ListItemText>
                            </MenuItem>
                        )}
                    </Menu>
                </>}>
                <Box sx={{ mt: 1.25 }} />
                {error && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>{error}</Typography>}
                {lookalikes.progress && <LinearProgress variant="determinate" value={lookalikes.progress.done / lookalikes.progress.total * 100} sx={{ height: 3, borderRadius: 2, mb: 1.5 }} />}
                {scanning && <LinearProgress variant={scanning === 'quick' ? 'indeterminate' : 'determinate'} value={progress} sx={{ height: 3, borderRadius: 2, mb: 1.5 }} />}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <TextField size="small" placeholder={t('search')} value={filters.searchQuery} onChange={e => update('searchQuery', e.target.value)} sx={{ flex: 1 }}
                        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment>, sx: { fontSize: '0.78rem', height: 32 } }} />
                    <Tooltip title={t('filters')}>
                        <IconButton size="small" onClick={() => setShowFilters(s => !s)} sx={{ ...iconButton, ...(showFilters ? { color: 'primary.main', bgcolor: 'action.selected' } : {}) }}><Filter size={16} /></IconButton>
                    </Tooltip>
                    <Tooltip title={allSelected ? t('deselectAll') : t('selectAll')}>
                        <IconButton size="small" onClick={allSelected ? clearSelection : selectAll} sx={iconButton}>{selected.size > 0 ? <CheckSquare size={16} /> : <Square size={16} />}</IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Select size="small" value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)} sx={{ fontSize: '0.72rem', height: 28 }} aria-label={t('sort')}>
                        {(['page', 'largest', 'smallest', 'type'] as const).map(s => <MenuItem key={s} value={s} sx={{ fontSize: '0.75rem' }}>{t(`sortBy.${s}`)}</MenuItem>)}
                    </Select>
                    <Select size="small" value={groupBy} onChange={e => { setGroupBy(e.target.value as GroupBy | 'none'); setActiveGroup(null); }} sx={{ fontSize: '0.72rem', height: 28 }} aria-label={t('group')}>
                        {(['none', 'size', 'section', 'domain'] as const).map(g => <MenuItem key={g} value={g} sx={{ fontSize: '0.75rem' }}>{t(`groupBy.${g}`)}</MenuItem>)}
                    </Select>
                    <Tooltip title={t('cardSize')}>
                        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 60, px: 1 }}>
                            <ImageIcon size={12} />
                            <Slider size="small" min={70} max={260} step={10} value={cardSize} onChange={(_, v) => setCardSize(v as number)} aria-label={t('cardSize')} />
                            <Maximize2 size={12} />
                        </Box>
                    </Tooltip>
                </Box>

                <Collapse in={showFilters}>
                    {/* Scrolls on its own, so the save options at its end stay reachable in a short side panel. */}
                    <Box sx={{ maxHeight: '55vh', overflowY: 'auto', pr: 0.5 }}>
                    <FiltersPanel filters={filters} update={update} toggle={toggle} reset={reset} domains={domains}>
                        <Box>
                            <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={fullSize.enabled} onChange={e => fullSize.setEnabled(e.target.checked)} />}
                                label={<Typography variant="caption" fontWeight={600}>{t('fullSize')}</Typography>} />
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.62rem' }}>
                                {fullSize.pending > 0 ? t('fullSizeSearching', { found: fullSize.found, pending: fullSize.pending }) : t('fullSizeFound', { count: fullSize.found })}
                            </Typography>
                        </Box>
                        <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={fold} onChange={e => setFold(e.target.checked)} />}
                            label={<Typography variant="caption" fontWeight={600}>{t('foldDuplicates')}</Typography>} />
                        <SaveOptions mode={saver.mode} onMode={saver.setMode} template={saver.template} onTemplate={saver.setTemplate} manifest={saver.manifest} onManifest={saver.setManifest}
                            processing={saver.processing} onProcessing={saver.setProcessing} />
                    </FiltersPanel>
                    </Box>
                </Collapse>
            </ToolHeader>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, pb: 10 }}>
                {saver.report && <SaveReportCard report={saver.report} onRetry={saver.retryFailed} onDismiss={saver.dismiss} />}
                {filtered.length === 0 && !scanning ? (
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center', color: 'text.secondary' }}>
                        <ImageIcon size={48} strokeWidth={1} />
                        <Box>
                            <Typography variant="body2" fontWeight={600} color="text.primary">{t('noImagesFound')}</Typography>
                            <Typography variant="caption">{images.length > 0 ? t('tryAdjustFilters') : t('navigateAndScan')}</Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                            {images.length > 0 && <Button size="small" variant="outlined" onClick={reset}>{t('resetFilters')}</Button>}
                            <Button size="small" variant="contained" onClick={() => void (images.length ? deepScan() : quickScan())} startIcon={<Search size={14} />}>
                                {images.length ? t('deepScanShort') : t('scanPage')}
                            </Button>
                        </Stack>
                    </Box>
                ) : groupBy !== 'none' && activeGroup === null ? (
                    <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ px: 0.5 }}>{t('groupCount', { count: groups.length })}</Typography>
                        {groups.map(group => (
                            <Paper key={group.label} variant="outlined" onClick={() => setActiveGroup(group.label)}
                                sx={theme => ({ p: 1.25, borderRadius: 2.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) } })}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
                                        {group.images.slice(0, 3).map(img => (
                                            <Box key={img.src} sx={{ width: 36, height: 36, borderRadius: '6px', overflow: 'hidden', bgcolor: 'action.hover' }}>
                                                <img src={img.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                            </Box>
                                        ))}
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, fontSize: '0.78rem' }}>{group.label}</Typography>
                                        <Typography variant="caption" color="text.secondary">{t('imagesInGroup', { count: group.images.length })}</Typography>
                                    </Box>
                                    <Tooltip title={t('downloadGroup')}>
                                        <span><IconButton size="small" sx={iconButton} disabled={downloading} onClick={e => { e.stopPropagation(); void saver.save(group.images); }}><Download size={13} /></IconButton></span>
                                    </Tooltip>
                                </Box>
                            </Paper>
                        ))}
                    </Stack>
                ) : (
                    <Box>
                        {groupBy !== 'none' && activeGroup !== null && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 0.5 }}>
                                <Chip label={activeGroup} size="small" color="primary" onDelete={() => setActiveGroup(null)} sx={{ maxWidth: 220 }} />
                                <Typography variant="caption" color="text.secondary">{t('imagesInGroup', { count: shown.length })}</Typography>
                                <Button size="small" onClick={selectAll}>{t('selectAll')}</Button>
                            </Box>
                        )}
                        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`, gap: 1 }}>
                            {shown.slice(0, visibleCount).map((img, i) => (
                                <ImageCard key={img.src} img={img} selected={selected.has(img.src)}
                                    onSelect={e => select(i, e)} onPreview={() => setPreview(i)} onDownload={() => void saver.save([img], 'folder')} />
                            ))}
                        </Box>
                        {visibleCount < shown.length && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
                                <Button size="small" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>{t('showMore', { count: shown.length - visibleCount })}</Button>
                            </Box>
                        )}
                    </Box>
                )}
                {scanning && filtered.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 2, color: 'text.secondary' }}>
                        <Loader size={14} className="animate-spin" />
                        <Typography variant="caption">{t('discoveringMore')}</Typography>
                    </Box>
                )}
            </Box>

            {preview !== null && (
                <ImageLightbox images={shown} index={preview} onIndex={setPreview} onClose={() => setPreview(null)}
                    onShowOnPage={showOnPage} onDownload={img => void saver.save([img], 'folder')} onCopyImage={copyImage} />
            )}

            <Fade in={selected.size > 0 || scanning === 'deep' || downloading || !!notice}>
                <Paper elevation={8} sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 30, p: '8px 12px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, border: 1, borderColor: 'divider' }}>
                    {saver.progress ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                <Loader size={14} className="animate-spin" />
                                <Typography variant="caption" fontWeight={600} noWrap>
                                    {t('saving', { done: saver.progress.done + saver.progress.failed, total: saver.progress.total, size: megabytes(saver.progress.bytes) })}
                                    {saver.progress.failed > 0 && ` · ${t('failedCount', { count: saver.progress.failed })}`}
                                </Typography>
                            </Box>
                            <Button size="small" color="error" onClick={saver.stop}>{t('stop')}</Button>
                        </>
                    ) : scanning === 'deep' ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Loader size={14} className="animate-spin" />
                                <Typography variant="caption" fontWeight={600}>{`${progress}%`}</Typography>
                            </Box>
                            <Button size="small" color="error" onClick={cancelScan}>{t('cancelScan')}</Button>
                        </>
                    ) : selected.size > 0 ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Chip size="small" color="primary" label={selected.size} sx={{ fontWeight: 800 }} />
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('selected')}</Typography>
                            </Box>
                            <Stack direction="row" spacing={0.5} alignItems="center">
                                <Button size="small" onClick={clearSelection}>{t('clear')}</Button>
                                <Tooltip title={t('copyUrls')}><IconButton size="small" onClick={() => void copyUrls(selectedImages)}><Copy size={15} /></IconButton></Tooltip>
                                <Tooltip title={t('saveToData')}><IconButton size="small" onClick={() => void saveToData(selectedImages)}><Database size={15} /></IconButton></Tooltip>
                                <Button variant="contained" size="small" startIcon={<Download size={13} />} onClick={() => void saver.save(selectedImages)}>{t('downloadSelected')}</Button>
                            </Stack>
                        </>
                    ) : (
                        <Typography variant="caption" fontWeight={600}>{notice}</Typography>
                    )}
                </Paper>
            </Fade>

            <Fade in={filtered.length > 0 && selected.size === 0 && !scanning && !downloading && !notice}>
                <Button variant="contained" startIcon={<Download size={14} />} onClick={() => void saver.save(filtered)}
                    sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 20, borderRadius: '12px', px: 2, py: 1, fontWeight: 700, textTransform: 'none' }}>
                    {t('downloadAll', { count: filtered.length })}
                </Button>
            </Fade>
        </Box>
    );
}
