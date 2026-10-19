import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box, Typography, Paper, Button, IconButton, Chip, Stack, LinearProgress,
    TextField, InputAdornment, Fade, Switch, FormControlLabel, Tooltip, Collapse, ToggleButtonGroup, ToggleButton
} from '@mui/material';
import {
    ChevronLeft,
    Image as ImageIcon,
    Download,
    Search,
    Filter,
    Check,
    Radio,
    RefreshCw,
    CheckSquare,
    Square,
    Loader,
    Grid,
    Layers,
    ArrowDownToLine
} from 'lucide-react';
import type { FoundImage } from '../../shared/images/types';
import { styled } from '@mui/material/styles';
import { useImageScan } from '../hooks/useImageScan';
import { buildSizeGroups, filterImages, imageType } from '../components/images/imageFilters';
import { downloadImage, downloadZip } from '../components/images/imageDownload';

const ImageCard = styled(Box)<{ selected?: boolean }>(({ selected }) => ({
    position: 'relative',
    aspectRatio: '1',
    borderRadius: '10px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: `2px solid ${selected ? '#06b6d4' : 'rgba(255, 255, 255, 0.05)'}`,
    transition: 'all 0.2s ease',
    background: 'rgba(0, 0, 0, 0.3)',
    '&:hover': {
        borderColor: selected ? '#06b6d4' : 'rgba(255, 255, 255, 0.15)',
        '& .download-btn': { opacity: 1 },
        '& .img-overlay': { opacity: 1 }
    }
}));

interface ImageDownloaderPageProps {
    onBack: () => void;
}

export default function ImageDownloaderPage({ onBack }: ImageDownloaderPageProps) {
    const { t } = useTranslation('imageDownloader');
    const { images, scanning, progress, liveWatching, error, quickScan, deepScan, cancelScan, toggleLiveWatch } = useImageScan();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [downloading, setDownloading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [minWidth, setMinWidth] = useState<number | ''>('');
    const [maxWidth, setMaxWidth] = useState<number | ''>('');
    const [minHeight, setMinHeight] = useState<number | ''>('');
    const [maxHeight, setMaxHeight] = useState<number | ''>('');
    const [fileTypes, setFileTypes] = useState<Set<string>>(new Set(['jpg', 'png', 'webp', 'gif', 'svg', 'avif']));
    const [sizeCategories, setSizeCategories] = useState<Set<string>>(new Set(['small', 'medium', 'large']));
    const [includeHidden, setIncludeHidden] = useState(true);
    const [viewMode, setViewMode] = useState<'grid' | 'grouped'>('grid');
    const [activeGroup, setActiveGroup] = useState<number | null>(null);

    const startQuickScan = () => {
        setSelected(new Set());
        void quickScan();
    };

    const scanInitRef = useRef(false);
    useEffect(() => {
        if (scanInitRef.current) return;
        scanInitRef.current = true;
        startQuickScan();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filteredImages = useMemo(
        () => filterImages(images, { includeHidden, searchQuery, minWidth, maxWidth, minHeight, maxHeight, fileTypes, sizeCategories }),
        [images, searchQuery, minWidth, maxWidth, minHeight, maxHeight, fileTypes, sizeCategories, includeHidden]);

    const sizeGroups = useMemo(() => buildSizeGroups(filteredImages), [filteredImages]);

    const displayImages = useMemo(() => {
        if (viewMode === 'grouped' && activeGroup !== null && sizeGroups[activeGroup]) return sizeGroups[activeGroup].images;
        return filteredImages;
    }, [viewMode, activeGroup, sizeGroups, filteredImages]);

    const PAGE_SIZE = 100;
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [displayImages]);

    const selectGroup = (idx: number) => {
        setActiveGroup(idx);
        setSelected(new Set(sizeGroups[idx].images.map(img => img.src)));
    };

    const downloadAsZip = async (imagesToDownload: FoundImage[], zipName: string) => {
        setDownloading(true);
        try { await downloadZip(imagesToDownload, zipName); } finally { setDownloading(false); }
    };

    const downloadGroup = (idx: number) => {
        const group = sizeGroups[idx];
        void downloadAsZip(group.images, `images_${group.label.replace('\u00d7', 'x')}.zip`);
    };

    const downloadSingle = (img: FoundImage, e?: React.MouseEvent) => {
        e?.stopPropagation();
        void downloadImage(img);
    };

    const downloadSelected = () => downloadAsZip(filteredImages.filter(img => selected.has(img.src)), 'selected_images.zip');
    const downloadAll = () => downloadAsZip(filteredImages, 'all_images.zip');

    const toggleSelection = (src: string) => {
        const next = new Set(selected);
        if (next.has(src)) next.delete(src); else next.add(src);
        setSelected(next);
    };

    const selectAll = () => setSelected(new Set(filteredImages.map(img => img.src)));
    const clearSelection = () => setSelected(new Set());

    const statusText = scanning
        ? (scanning === 'quick' ? t('reading') : t('scanning', { progress }))
        : liveWatching
            ? t('liveWatching')
            : t('imagesCount', { filtered: filteredImages.length, total: images.length });

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Header */}
            <Paper
                elevation={0}
                sx={{
                    p: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    zIndex: 10,
                    background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                    <IconButton onClick={onBack} size="small" sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: 'white' } }}>
                        <ChevronLeft size={20} />
                    </IconButton>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
                            {t('title')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, mt: 0.5, display: 'block', opacity: 0.8 }}>
                            {statusText}
                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                        <Tooltip title={liveWatching ? t('stopWatching') : t('liveWatch')}>
                            <IconButton onClick={toggleLiveWatch} size="small" sx={{ color: liveWatching ? '#06b6d4' : 'text.secondary', bgcolor: liveWatching ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(6, 182, 212, 0.15)' } }}>
                                <Radio size={18} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('deepScan')}>
                            <IconButton onClick={() => void deepScan()} disabled={!!scanning} size="small" sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#06b6d4' } }}>
                                <ArrowDownToLine size={18} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('rescan')}>
                            <IconButton onClick={startQuickScan} disabled={!!scanning} size="small" sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: '#06b6d4' } }}>
                                <RefreshCw size={18} className={scanning === 'quick' ? 'animate-spin' : ''} />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                </Box>

                {error && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>{error}</Typography>}
                {scanning && (
                    <LinearProgress
                        variant={scanning === 'quick' ? 'indeterminate' : 'determinate'}
                        value={progress}
                        sx={{ height: 3, borderRadius: 2, mb: 1.5, bgcolor: 'rgba(255,255,255,0.05)', '& .MuiLinearProgress-bar': { bgcolor: '#06b6d4' } }}
                    />
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                        size="small"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: <InputAdornment position="start"><Search size={14} style={{ opacity: 0.4 }} /></InputAdornment>,
                            sx: { borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.78rem', height: 32 }
                        }}
                        sx={{ flex: 1, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}
                    />
                    <Tooltip title={t('filters')}>
                        <IconButton size="small" onClick={() => setShowFilters(!showFilters)} sx={{ color: showFilters ? '#06b6d4' : 'text.secondary', bgcolor: showFilters ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}>
                            <Filter size={16} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={selected.size === filteredImages.length && filteredImages.length > 0 ? t('deselectAll') : t('selectAll')}>
                        <IconButton size="small" onClick={selected.size === filteredImages.length && filteredImages.length > 0 ? clearSelection : selectAll} sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' } }}>
                            {selected.size > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                        </IconButton>
                    </Tooltip>
                    <ToggleButtonGroup value={viewMode} exclusive onChange={(_, v) => { if (v) { setViewMode(v); if (v === 'grid') setActiveGroup(null); } }} size="small" sx={{ height: 28, '& .MuiToggleButton-root': { px: 1, border: 'none', bgcolor: 'rgba(255,255,255,0.03)', color: 'text.secondary', '&.Mui-selected': { bgcolor: 'rgba(6, 182, 212, 0.1)', color: '#06b6d4' } } }}>
                        <ToggleButton value="grid"><Grid size={14} /></ToggleButton>
                        <ToggleButton value="grouped"><Layers size={14} /></ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                <Collapse in={showFilters}>
                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <Stack spacing={1.5}>
                            <Box>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>{t('format')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {['jpg', 'png', 'svg', 'gif', 'webp', 'avif'].map(type => (
                                        <Chip key={type} label={type} onClick={() => { const next = new Set(fileTypes); if (next.has(type)) next.delete(type); else next.add(type); setFileTypes(next); }} size="small" color={fileTypes.has(type) ? 'primary' : 'default'} variant={fileTypes.has(type) ? 'filled' : 'outlined'} sx={{ borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700, height: 22 }} />
                                    ))}
                                </Box>
                            </Box>
                            <Box>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>{t('size')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {[{ id: 'small', label: '< 500px' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }].map(cat => (
                                        <Chip key={cat.id} label={cat.label} onClick={() => { const next = new Set(sizeCategories); if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id); setSizeCategories(next); }} size="small" color={sizeCategories.has(cat.id) ? 'secondary' : 'default'} variant={sizeCategories.has(cat.id) ? 'filled' : 'outlined'} sx={{ borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700, height: 22 }} />
                                    ))}
                                </Box>
                            </Box>
                            <Box>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>{t('dimensions')}</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                                    <TextField size="small" placeholder={t('minW')} type="number" value={minWidth} onChange={(e) => setMinWidth(e.target.value ? Number(e.target.value) : '')} InputProps={{ sx: { borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.7rem', height: 28 } }} sx={{ width: 70, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
                                    <TextField size="small" placeholder={t('maxW')} type="number" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value ? Number(e.target.value) : '')} InputProps={{ sx: { borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.7rem', height: 28 } }} sx={{ width: 70, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', px: 0.25 }}>×</Typography>
                                    <TextField size="small" placeholder={t('minH')} type="number" value={minHeight} onChange={(e) => setMinHeight(e.target.value ? Number(e.target.value) : '')} InputProps={{ sx: { borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.7rem', height: 28 } }} sx={{ width: 70, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
                                    <TextField size="small" placeholder={t('maxH')} type="number" value={maxHeight} onChange={(e) => setMaxHeight(e.target.value ? Number(e.target.value) : '')} InputProps={{ sx: { borderRadius: '8px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.7rem', height: 28 } }} sx={{ width: 70, '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }} />
                                </Box>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <FormControlLabel control={<Switch checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} size="small" />} label={<Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{t('includeHidden')}</Typography>} sx={{ ml: 0 }} />
                            </Box>
                        </Stack>
                    </Box>
                </Collapse>
            </Paper>

            {/* Image Grid */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.08)', borderRadius: 4 } }}>
                {filteredImages.length === 0 && !scanning ? (
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center', opacity: 0.6 }}>
                        <ImageIcon size={48} strokeWidth={1} />
                        <Box>
                            <Typography variant="body2" fontWeight={600}>{t('noImagesFound')}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                {images.length > 0 ? t('tryAdjustFilters') : t('navigateAndScan')}
                            </Typography>
                        </Box>
                        {images.length === 0 && (
                            <Button variant="contained" size="small" onClick={startQuickScan} disabled={!!scanning} startIcon={<Search size={14} />} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 700, mt: 1 }}>
                                {t('scanPage')}
                            </Button>
                        )}
                    </Box>
                ) : viewMode === 'grouped' && activeGroup === null ? (
                    <Stack spacing={1}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', px: 0.5 }}>
                            {t('sizeDistribution', { count: sizeGroups.length })}
                        </Typography>
                        {sizeGroups.map((group, idx) => (
                            <Paper key={idx} elevation={0} onClick={() => selectGroup(idx)} sx={{ p: 1.5, borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', cursor: 'pointer', transition: 'all 0.15s', '&:hover': { borderColor: 'rgba(6, 182, 212, 0.4)', bgcolor: 'rgba(6, 182, 212, 0.03)' } }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <Box sx={{ width: 40, height: 40, borderRadius: '8px', overflow: 'hidden', flexShrink: 0, bgcolor: 'rgba(0,0,0,0.3)' }}>
                                        <img src={group.images[0].src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.78rem', lineHeight: 1.2 }}>
                                                {group.label}
                                            </Typography>
                                            <Chip label={`${group.images.length}`} size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 800, bgcolor: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', borderRadius: '6px', minWidth: 28 }} />
                                        </Box>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                            {t('percentOfImages', { percent: Math.round(group.images.length / filteredImages.length * 100) })}
                                        </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={0.5}>
                                        <Tooltip title={t('downloadGroup')}>
                                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); downloadGroup(idx); }} sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', width: 28, height: 28, '&:hover': { bgcolor: 'rgba(6, 182, 212, 0.1)', color: '#06b6d4' } }}>
                                                <Download size={13} />
                                            </IconButton>
                                        </Tooltip>
                                    </Stack>
                                </Box>
                            </Paper>
                        ))}
                    </Stack>
                ) : (
                    <Box>
                        {viewMode === 'grouped' && activeGroup !== null && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 0.5 }}>
                                <Chip label={sizeGroups[activeGroup]?.label} size="small" onDelete={() => { setActiveGroup(null); clearSelection(); }} sx={{ height: 22, fontSize: '0.65rem', fontWeight: 700, borderRadius: '6px', bgcolor: 'rgba(6, 182, 212, 0.12)', color: '#06b6d4' }} />
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                    {t('imagesInGroup', { count: displayImages.length })}
                                </Typography>
                            </Box>
                        )}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                        {displayImages.slice(0, visibleCount).map((img, i) => {
                            const isSelected = selected.has(img.src);
                            return (
                                <ImageCard key={img.src + i} selected={isSelected} onClick={() => toggleSelection(img.src)}>
                                    <img src={img.src} alt={img.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                    <Box className="img-overlay" sx={{ position: 'absolute', inset: 0, bgcolor: isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(0,0,0,0.25)', opacity: isSelected ? 1 : 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'start', justifyContent: 'end', p: 0.5 }}>
                                        <Box sx={{ width: 18, height: 18, borderRadius: '5px', bgcolor: isSelected ? '#06b6d4' : 'rgba(255,255,255,0.2)', border: '1.5px solid rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {isSelected && <Check size={12} strokeWidth={3} color="white" />}
                                        </Box>
                                    </Box>
                                    <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, px: 0.5, py: 0.25, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '8px' }}>{img.width && img.height ? `${img.width}\u00d7${img.height}` : '?'}</Typography>
                                        <Box sx={{ px: 0.5, borderRadius: '3px', bgcolor: 'rgba(255,255,255,0.12)', fontSize: '7px', fontWeight: 800, color: 'white', textTransform: 'uppercase' }}>{imageType(img) || '?'}</Box>
                                    </Box>
                                    <IconButton className="download-btn" size="small" onClick={(e) => downloadSingle(img, e)} sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'rgba(6, 182, 212, 0.9)', color: 'white', opacity: 0, transition: 'opacity 0.15s', width: 28, height: 28, '&:hover': { bgcolor: '#06b6d4' } }}>
                                        <Download size={14} />
                                    </IconButton>
                                </ImageCard>
                            );
                        })}
                    </Box>
                    {visibleCount < displayImages.length && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
                            <Typography onClick={() => setVisibleCount(c => c + PAGE_SIZE)} variant="caption" sx={{ cursor: 'pointer', color: '#06b6d4', '&:hover': { textDecoration: 'underline' } }}>
                                Show more ({displayImages.length - visibleCount} remaining)
                            </Typography>
                        </Box>
                    )}
                    </Box>
                )}
                {scanning && filteredImages.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 2, opacity: 0.5 }}>
                        <Loader size={14} className="animate-spin" />
                        <Typography variant="caption">{t('discoveringMore')}</Typography>
                    </Box>
                )}
            </Box>

            {/* Floating Footer */}
            <Fade in={selected.size > 0 || scanning === 'deep'}>
                <Paper elevation={8} sx={{ position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 30, p: '10px 16px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 12px 32px -8px rgba(0, 0, 0, 0.6)' }}>
                    {selected.size > 0 ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ minWidth: 26, height: 26, borderRadius: '8px', bgcolor: '#06b6d4', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.75rem', px: 0.5 }}>{selected.size}</Box>
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{t('selected')}</Typography>
                            </Box>
                            <Stack direction="row" spacing={1}>
                                <Button size="small" onClick={clearSelection} sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'none', minWidth: 'auto', fontSize: '0.72rem' }}>{t('clear')}</Button>
                                <Button variant="contained" size="small" startIcon={downloading ? <Loader size={13} className="animate-spin" /> : <Download size={13} />} disabled={downloading} onClick={downloadSelected} sx={{ borderRadius: '10px', px: 2, fontWeight: 700, textTransform: 'none', fontSize: '0.72rem', background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' }}>
                                    {downloading ? t('packing') : t('downloadZip')}
                                </Button>
                            </Stack>
                        </>
                    ): scanning === 'deep' ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Loader size={14} className="animate-spin" style={{ color: '#06b6d4' }} />
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{`${progress}%`}</Typography>
                            </Box>
                            <Button size="small" onClick={cancelScan} sx={{ color: 'error.main', fontWeight: 600, textTransform: 'none', fontSize: '0.72rem' }}>{t('cancelScan')}</Button>
                        </>
                    ) : null}
                </Paper>
            </Fade>

            <Fade in={filteredImages.length > 0 && selected.size === 0 && !scanning}>
                <Button variant="contained" startIcon={<Download size={14} />} onClick={downloadAll} disabled={downloading} sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 20, borderRadius: '12px', px: 2, py: 1, fontWeight: 700, textTransform: 'none', fontSize: '0.75rem', background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', boxShadow: '0 8px 20px -4px rgba(6, 182, 212, 0.4)', '&:hover': { background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)' } }}>
                    {t('downloadAll', { count: filteredImages.length })}
                </Button>
            </Fade>
        </Box>
    );
}