import { useState, useMemo, useEffect, useRef } from 'react';
import {
    Box, Typography, Paper, Button, IconButton, Chip, Stack, Grid,
    TextField, InputAdornment, Fade, Switch,
    FormControlLabel, Tooltip
} from '@mui/material';
import {
    ArrowLeft,
    Image as ImageIcon,
    Download,
    Search,
    Filter,
    Check,
    X,
    Trash2,
    Grid as GridIcon,
    Maximize2,
    FileType,
    RefreshCw
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ImageMeta } from '../../content/features/universal-images/ImageScanner';
import { styled } from '@mui/material/styles';

const GlassPaper = styled(Paper)(() => ({
    padding: '24px',
    borderRadius: '24px',
    background: 'rgba(15, 23, 42, 0.8)',
    backdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    position: 'relative',
    overflow: 'hidden'
}));

const ImageCard = styled(Box)<{ selected?: boolean }>(({ selected }) => ({
    position: 'relative',
    aspectRatio: '1',
    borderRadius: '16px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: `2px solid ${selected ? '#06b6d4' : 'rgba(255, 255, 255, 0.05)'}`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    background: 'rgba(0, 0, 0, 0.2)',
    '&:hover': {
        transform: 'translateY(-4px) scale(1.02)',
        borderColor: selected ? '#06b6d4' : 'rgba(255, 255, 255, 0.2)',
        boxShadow: '0 12px 24px -10px rgba(0,0,0,0.5)',
        '& .download-btn': { opacity: 1 },
        '& .img-overlay': { opacity: 1 }
    }
}));


interface ImageDownloaderPageProps {
    onBack: () => void;
}

export default function ImageDownloaderPage({ onBack }: ImageDownloaderPageProps) {
    const [images, setImages] = useState<ImageMeta[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [downloading, setDownloading] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [discoveryMode, setDiscoveryMode] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const syncTimerRef = useRef<any>(null);

    // Advanced Filters State
    const [searchQuery, setSearchQuery] = useState('');
    const [minWidth, setMinWidth] = useState<number | ''>('');
    const [maxWidth, setMaxWidth] = useState<number | ''>('');
    const [minHeight, setMinHeight] = useState<number | ''>('');
    const [maxHeight, setMaxHeight] = useState<number | ''>('');
    const [fileTypes, setFileTypes] = useState<Set<string>>(new Set(['jpg', 'png', 'webp', 'gif', 'svg']));
    const [sizeCategories, setSizeCategories] = useState<Set<string>>(new Set(['small', 'medium', 'large']));
    const [altTextFilter, setAltTextFilter] = useState<'all' | 'with' | 'without'>('all');
    const [grouping, setGrouping] = useState<'none' | 'size' | 'type'>('size');
    const [onlyVisible, setOnlyVisible] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const toggleGroupExpansion = (groupName: string) => {
        const next = new Set(expandedGroups);
        if (next.has(groupName)) next.delete(groupName);
        else next.add(groupName);
        setExpandedGroups(next);
    };

    const toggleFileType = (type: string) => {
        const next = new Set(fileTypes);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        setFileTypes(next);
    };

    const toggleSizeCategory = (cat: string) => {
        const next = new Set(sizeCategories);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        setSizeCategories(next);
    };

    const clearFilters = () => {
        setSearchQuery('');
        setMinWidth('');
        setMaxWidth('');
        setMinHeight('');
        setMaxHeight('');
        setFileTypes(new Set(['jpg', 'png', 'webp', 'gif', 'svg']));
        setSizeCategories(new Set(['small', 'medium', 'large']));
        setAltTextFilter('all');
        setOnlyVisible(true);
    };

    const getExtension = (src: string) => {
        try {
            const url = new URL(src);
            const pathname = url.pathname;
            const ext = pathname.split('.').pop()?.toLowerCase();
            return ext && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
        } catch {
            return 'jpg';
        }
    };

    const getSizeCategory = (width: number, height: number) => {
        const pixels = width * height;
        if (pixels < 500 * 500) return 'small';
        if (pixels < 1920 * 1080) return 'medium';
        return 'large';
    };

    const filteredImages = images.filter(img => {
        // Visible Only
        if (onlyVisible && img.isVisible === false) return false;

        // Search
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const match = img.src.toLowerCase().includes(query) ||
                (img.alt && img.alt.toLowerCase().includes(query)) ||
                `${img.naturalWidth}x${img.naturalHeight}`.includes(query);
            if (!match) return false;
        }

        // Dimensions
        if (minWidth !== '' && img.naturalWidth < minWidth) return false;
        if (maxWidth !== '' && img.naturalWidth > maxWidth) return false;
        if (minHeight !== '' && img.naturalHeight < minHeight) return false;
        if (maxHeight !== '' && img.naturalHeight > maxHeight) return false;

        // File Type
        const ext = getExtension(img.src);
        if (!fileTypes.has(ext)) return false;

        // Size Category
        const cat = getSizeCategory(img.naturalWidth, img.naturalHeight);
        if (!sizeCategories.has(cat)) return false;

        // Alt Text
        if (altTextFilter === 'with' && !img.alt) return false;
        if (altTextFilter === 'without' && img.alt) return false;

        return true;
    });

    const scanImages = async (accumulate = false) => {
        setLoading(true);
        if (!accumulate) {
            setImages([]); // Clear previous results
            setSelected(new Set()); // Clear selection
        }
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'SCAN_IMAGES',
                    action: 'SCAN_IMAGES',
                    payload: { accumulate }
                });
                if (response && response.data) {
                    setImages(response.data);
                }
            }
        } catch (error) {
            console.error('Scan failed:', error);
        } finally {
            setLoading(false);
        }
    };

    // Discovery Mode Listener
    useEffect(() => {
        const listener = (message: any) => {
            if (message.type === 'IMAGE_DISCOVERY_UPDATE' && message.payload?.images) {
                setImages(message.payload.images);

                // Show sync indicator
                setIsSyncing(true);
                if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
                syncTimerRef.current = setTimeout(() => {
                    setIsSyncing(false);
                }, 1000);
            }
        };

        chrome.runtime.onMessage.addListener(listener);

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        };
    }, []);

    // Discovery Mode Effect
    useEffect(() => {
        const toggleDiscovery = async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                if (discoveryMode) {
                    await chrome.tabs.sendMessage(tab.id, { type: 'START_IMAGE_DISCOVERY' });
                } else {
                    await chrome.tabs.sendMessage(tab.id, { type: 'STOP_IMAGE_DISCOVERY' });
                }
            }
        };
        toggleDiscovery();

        return () => {
            // Clean up discovery on unmount
            const cleanup = async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab?.id) {
                    await chrome.tabs.sendMessage(tab.id, { type: 'STOP_IMAGE_DISCOVERY' });
                }
            };
            cleanup();
        };
    }, [discoveryMode]);

    const groupedImages = useMemo(() => {
        if (grouping === 'none') return { 'All Images': filteredImages };

        const groups: Record<string, ImageMeta[]> = {};
        filteredImages.forEach(img => {
            let key = '';
            if (grouping === 'size') key = `${img.naturalWidth}x${img.naturalHeight}`;
            else if (grouping === 'type') key = getExtension(img.src).toUpperCase();

            if (!groups[key]) groups[key] = [];
            groups[key].push(img);
        });

        // Sort logic
        return Object.fromEntries(
            Object.entries(groups).sort(([keyA, listA], [keyB, listB]) => {
                if (grouping === 'size') {
                    // Sort by resolution (Width x Height) descending
                    const [wA, hA] = keyA.split('x').map(Number);
                    const [wB, hB] = keyB.split('x').map(Number);
                    const resA = (wA || 0) * (hA || 0);
                    const resB = (wB || 0) * (hB || 0);
                    if (resB !== resA) return resB - resA;
                }
                // Fallback / Default: Sort by count descending
                return listB.length - listA.length;
            })
        );
    }, [filteredImages, grouping]);

    // Helper for throttled downloads
    const processInBatches = async <T,>(items: T[], batchSize: number, delayArr: [number, number], fn: (item: T, i: number) => Promise<void>) => {
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            await Promise.all(batch.map((item, index) => fn(item, i + index)));

            // Delay between batches
            if (i + batchSize < items.length) {
                const delay = Math.floor(Math.random() * (delayArr[1] - delayArr[0] + 1)) + delayArr[0];
                await new Promise(r => setTimeout(r, delay));
            }
        }
    };

    const downloadImage = (url: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const filename = `image-${Date.now()}.${getExtension(url)}`;
        saveAs(url, filename);
    };

    const downloadGroup = async (groupImages: ImageMeta[], groupName: string) => {
        setDownloading(true);
        const zip = new JSZip();
        try {
            await processInBatches(groupImages, 3, [500, 1000], async (img, i) => {
                try {
                    const response = await fetch(img.src);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();
                    const ext = blob.type.split('/')[1] || 'jpg';
                    zip.file(`image_${i + 1}.${ext}`, blob);
                } catch (e) {
                    console.error(`Failed to fetch item in group ${groupName}:`, e);
                }
            });

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${groupName.replace(/[^a-z0-9]/gi, '_')}_images.zip`);
        } catch (e) {
            console.error(`Group download failed: ${groupName}`, e);
        } finally {
            setDownloading(false);
        }
    };

    const downloadSelected = async () => {
        if (selected.size === 0) return;
        setDownloading(true);
        const zip = new JSZip();
        const selectedUrls = Array.from(selected);

        try {
            await processInBatches(selectedUrls, 3, [500, 1000], async (url, i) => {
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();
                    const ext = blob.type.split('/')[1] || 'jpg';
                    zip.file(`image_${i + 1}.${ext}`, blob);
                } catch (e) {
                    console.error('Failed to fetch selected image:', e);
                }
            });

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, 'selected_images.zip');
        } catch (e) {
            console.error('Download selected failed:', e);
        } finally {
            setDownloading(false);
        }
    };

    const downloadAll = async () => {
        if (filteredImages.length === 0) return;
        setDownloading(true);
        const zip = new JSZip();

        try {
            await processInBatches(filteredImages, 3, [500, 1000], async (img, i) => {
                try {
                    const response = await fetch(img.src);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();
                    const ext = blob.type.split('/')[1] || 'jpg';
                    zip.file(`image_${i + 1}.${ext}`, blob);
                } catch (e) {
                    console.error('Failed to fetch image:', e);
                }
            });

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, 'all_page_images.zip');
        } catch (e) {
            console.error('Download all failed:', e);
        } finally {
            setDownloading(false);
        }
    };

    const toggleSelection = (src: string) => {
        const next = new Set(selected);
        if (next.has(src)) next.delete(src);
        else next.add(src);
        setSelected(next);
    };

    return (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', position: 'relative', overflow: 'hidden' }}>
            {/* Filter Overlay */}
            <Fade in={showFilters}>
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 100,
                        bgcolor: 'rgba(2, 6, 23, 0.6)',
                        backdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 2
                    }}
                >
                    <GlassPaper sx={{ width: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column' }}>
                        {/* Filter Header */}
                        <Box sx={{
                            pb: 2,
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'primary.main', color: 'white', display: 'flex' }}>
                                    <Filter size={18} />
                                </Box>
                                <Typography variant="h6" fontWeight="700">Refine Search</Typography>
                            </Box>
                            <IconButton size="small" onClick={() => setShowFilters(false)} sx={{ color: 'rgba(255,255,255,0.3)' }}>
                                <X size={20} />
                            </IconButton>
                        </Box>

                        {/* Filter Content */}
                        <Box sx={{ flex: 1, overflowY: 'auto', py: 3, pr: 1, '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: '10px' } }}>
                            <Stack spacing={4}>
                                {/* Info / Grouping */}
                                <Box>
                                    <Typography variant="caption" fontWeight="700" color="primary.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5, display: 'block' }}>
                                        Grouping & Layout
                                    </Typography>
                                    <Stack direction="row" spacing={1}>
                                        {[
                                            { id: 'none', label: 'Simple', icon: <GridIcon size={14} /> },
                                            { id: 'size', label: 'Resolution', icon: <Maximize2 size={14} /> },
                                            { id: 'type', label: 'Format', icon: <FileType size={14} /> }
                                        ].map(opt => (
                                            <Button
                                                key={opt.id}
                                                variant={grouping === opt.id ? 'contained' : 'outlined'}
                                                size="small"
                                                onClick={() => setGrouping(opt.id as any)}
                                                startIcon={opt.icon}
                                                sx={{
                                                    flex: 1,
                                                    borderRadius: '12px',
                                                    textTransform: 'none',
                                                    fontWeight: 600,
                                                    borderColor: 'rgba(255,255,255,0.1)',
                                                    bgcolor: grouping === opt.id ? 'primary.main' : 'transparent'
                                                }}
                                            >
                                                {opt.label}
                                            </Button>
                                        ))}
                                    </Stack>
                                </Box>

                                {/* Search */}
                                <Box>
                                    <Typography variant="caption" fontWeight="700" color="primary.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5, display: 'block' }}>
                                        Content Search
                                    </Typography>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="Alt text or URL keyword..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <Search size={16} className="text-slate-500" />
                                                </InputAdornment>
                                            ),
                                            sx: { borderRadius: '12px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.85rem' }
                                        }}
                                        sx={{ '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}
                                    />
                                </Box>

                                {/* Dimensions Filter */}
                                <Box>
                                    <Typography variant="caption" fontWeight="700" color="primary.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5, display: 'block' }}>
                                        Resolution Range (px)
                                    </Typography>
                                    <Grid container spacing={2}>
                                        <Grid size={6}>
                                            <Stack spacing={1}>
                                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Width</Typography>
                                                <Stack direction="row" spacing={1}>
                                                    <TextField
                                                        size="small"
                                                        placeholder="Min"
                                                        type="number"
                                                        value={minWidth}
                                                        onChange={(e) => setMinWidth(e.target.value ? Number(e.target.value) : '')}
                                                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.8rem' } }}
                                                    />
                                                    <TextField
                                                        size="small"
                                                        placeholder="Max"
                                                        type="number"
                                                        value={maxWidth}
                                                        onChange={(e) => setMaxWidth(e.target.value ? Number(e.target.value) : '')}
                                                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.8rem' } }}
                                                    />
                                                </Stack>
                                            </Stack>
                                        </Grid>
                                        <Grid size={6}>
                                            <Stack spacing={1}>
                                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>Height</Typography>
                                                <Stack direction="row" spacing={1}>
                                                    <TextField
                                                        size="small"
                                                        placeholder="Min"
                                                        type="number"
                                                        value={minHeight}
                                                        onChange={(e) => setMinHeight(e.target.value ? Number(e.target.value) : '')}
                                                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.8rem' } }}
                                                    />
                                                    <TextField
                                                        size="small"
                                                        placeholder="Max"
                                                        type="number"
                                                        value={maxHeight}
                                                        onChange={(e) => setMaxHeight(e.target.value ? Number(e.target.value) : '')}
                                                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', bgcolor: 'rgba(0,0,0,0.2)', fontSize: '0.8rem' } }}
                                                    />
                                                </Stack>
                                            </Stack>
                                        </Grid>
                                    </Grid>
                                </Box>

                                {/* File Types */}
                                <Box>
                                    <Typography variant="caption" fontWeight="700" color="primary.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5, display: 'block' }}>
                                        Formats
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        {['jpg', 'png', 'svg', 'gif', 'webp'].map(type => (
                                            <Chip
                                                key={type}
                                                label={`.${type}`}
                                                onClick={() => toggleFileType(type)}
                                                color={fileTypes.has(type) ? 'primary' : 'default'}
                                                variant={fileTypes.has(type) ? 'filled' : 'outlined'}
                                                size="small"
                                                sx={{ borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700 }}
                                            />
                                        ))}
                                    </Box>
                                </Box>

                                {/* Size Categories */}
                                <Box>
                                    <Typography variant="caption" fontWeight="700" color="primary.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5, display: 'block' }}>
                                        Size Category
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        {[
                                            { id: 'small', label: 'Small (< 0.25MP)' },
                                            { id: 'medium', label: 'Medium' },
                                            { id: 'large', label: 'Extra Large' }
                                        ].map(cat => (
                                            <Chip
                                                key={cat.id}
                                                label={cat.label}
                                                onClick={() => toggleSizeCategory(cat.id)}
                                                color={sizeCategories.has(cat.id) ? 'secondary' : 'default'}
                                                variant={sizeCategories.has(cat.id) ? 'filled' : 'outlined'}
                                                size="small"
                                                sx={{ borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700 }}
                                            />
                                        ))}
                                    </Box>
                                </Box>

                                {/* Visibility & Metadata */}
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={onlyVisible}
                                                onChange={(e) => setOnlyVisible(e.target.checked)}
                                                size="small"
                                            />
                                        }
                                        label={<Typography variant="body2" sx={{ fontWeight: 600 }}>Visible Only</Typography>}
                                    />
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        {['all', 'with', 'without'].map(opt => (
                                            <Chip
                                                key={opt}
                                                label={opt === 'all' ? 'All' : opt === 'with' ? 'Has Alt' : 'No Alt'}
                                                onClick={() => setAltTextFilter(opt as any)}
                                                color={altTextFilter === opt ? 'primary' : 'default'}
                                                variant={altTextFilter === opt ? 'filled' : 'outlined'}
                                                size="small"
                                                sx={{ borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700 }}
                                            />
                                        ))}
                                    </Box>
                                </Box>
                            </Stack>
                        </Box>

                        {/* Filter Footer */}
                        <Box sx={{ pt: 2, borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Button size="small" color="error" onClick={clearFilters} startIcon={<Trash2 size={16} />} sx={{ textTransform: 'none', fontWeight: 600 }}>
                                Reset
                            </Button>
                            <Button variant="contained" onClick={() => setShowFilters(false)} sx={{ borderRadius: '12px', px: 4, textTransform: 'none', fontWeight: 700 }}>
                                Apply
                            </Button>
                        </Box>
                    </GlassPaper>
                </Box>
            </Fade>

            {/* Main Header */}
            <Box sx={{
                p: 2.5,
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(2, 6, 23, 0.7)',
                backdropFilter: 'blur(20px)',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <IconButton onClick={onBack} sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                        <ArrowLeft size={20} />
                    </IconButton>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="h6" fontWeight="800" sx={{ letterSpacing: '-0.02em' }}>
                                Image Downloader
                            </Typography>
                            {loading && <RefreshCw size={16} className="animate-spin text-cyan-400" />}
                            <Tooltip title="Discovery Mode: Automatically finds images as you scroll">
                                <FormControlLabel
                                    control={
                                        <Switch
                                            size="small"
                                            checked={discoveryMode}
                                            onChange={(e) => setDiscoveryMode(e.target.checked)}
                                            color="secondary"
                                        />
                                    }
                                    label={
                                        <Typography variant="caption" sx={{ color: discoveryMode ? 'secondary.main' : 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                                            Discovery
                                        </Typography>
                                    }
                                    sx={{ ml: 2, mr: 0 }}
                                />
                            </Tooltip>
                        </Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                            {images.length} images discovered ({filteredImages.length} filtered)
                            {isSyncing && (
                                <Box component="span" sx={{ color: 'secondary.main', display: 'flex', alignItems: 'center', gap: 0.5, animation: 'pulse 1.5s infinite' }}>
                                    <Box sx={{ width: 6, height: 6, bgcolor: 'currentColor', borderRadius: '50%' }} />
                                    Syncing...
                                </Box>
                            )}
                        </Typography>
                    </Box>
                </Box>

                <Stack direction="row" spacing={1.5}>
                    <Tooltip title="Deep Scan">
                        <IconButton
                            onClick={() => scanImages(discoveryMode)}
                            disabled={loading}
                            sx={{
                                color: 'white',
                                bgcolor: 'rgba(255,255,255,0.05)',
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', color: 'primary.main' }
                            }}
                        >
                            <RefreshCw size={20} />
                        </IconButton>
                    </Tooltip>

                    <Button
                        variant="contained"
                        onClick={() => setShowFilters(true)}
                        startIcon={<Filter size={18} />}
                        sx={{
                            borderRadius: '12px',
                            px: 2.5,
                            bgcolor: 'rgba(255,255,255,0.05)',
                            color: 'white',
                            textTransform: 'none',
                            fontWeight: 700,
                            border: '1px solid rgba(255,255,255,0.1)',
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', borderColor: 'primary.main' }
                        }}
                    >
                        Filters
                    </Button>

                    <Button
                        variant="contained"
                        onClick={downloadAll}
                        disabled={downloading || filteredImages.length === 0}
                        startIcon={<Download size={18} />}
                        sx={{
                            borderRadius: '12px',
                            px: 3,
                            fontWeight: 800,
                            textTransform: 'none',
                            background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                            '&:hover': { background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)' }
                        }}
                    >
                        Download All
                    </Button>
                </Stack>
            </Box>

            {/* Content Area */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
                {images.length === 0 ? (
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, textAlign: 'center' }}>
                        <Box sx={{ position: 'relative', p: 4, borderRadius: '32px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)', color: 'rgba(255, 255, 255, 0.1)', display: 'flex' }}>
                            <ImageIcon size={64} strokeWidth={1} />
                            <Box sx={{ position: 'absolute', bottom: -10, right: -10, p: 1.5, borderRadius: '16px', bgcolor: 'primary.main', color: 'white', boxShadow: '0 10px 20px -5px rgba(37, 99, 235, 0.5)', display: 'flex' }}>
                                <Search size={20} />
                            </Box>
                        </Box>
                        <Box sx={{ maxWidth: 280 }}>
                            <Typography variant="h6" fontWeight="700" gutterBottom>No images detected</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.7 }}>
                                Run a deep scan to extract media from this page.
                            </Typography>
                        </Box>
                        <Button variant="outlined" onClick={() => scanImages(discoveryMode)} size="large" startIcon={<RefreshCw size={18} />} sx={{ borderRadius: '16px', px: 4, py: 1.5, border: '2px solid rgba(255, 255, 255, 0.1)', color: 'white', fontWeight: 700, textTransform: 'none', '&:hover': { border: '2px solid primary.main', bgcolor: 'rgba(6, 182, 212, 0.05)' } }}>
                            Start Deep Scan
                        </Button>
                    </Box>
                ) : (
                    <Stack spacing={4}>
                        {Object.entries(groupedImages).map(([groupName, groupImgs]) => {
                            const isExpanded = expandedGroups.has(groupName);
                            const limit = 24;
                            const displayedImgs = isExpanded ? groupImgs : groupImgs.slice(0, limit);
                            const hasMore = groupImgs.length > limit;

                            return (
                                <Box key={groupName}>
                                    {grouping !== 'none' && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, pb: 1, borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                                <Typography variant="subtitle2" sx={{ color: 'white', fontWeight: 700, letterSpacing: '0.02em' }}>
                                                    {groupName}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 600 }}>
                                                    {groupImgs.length} images
                                                </Typography>
                                            </Box>
                                            <Button size="small" variant="text" startIcon={<Download size={14} />} onClick={() => downloadGroup(groupImgs, groupName)} sx={{ textTransform: 'none', fontWeight: 600, color: 'rgba(255, 255, 255, 0.5)', '&:hover': { color: 'primary.main', bgcolor: 'rgba(6, 182, 212, 0.05)' } }}>
                                                Zip Group
                                            </Button>
                                        </Box>
                                    )}
                                    <Grid container spacing={1.5}>
                                        {displayedImgs.map((img, i) => {
                                            const isSelected = selected.has(img.src);
                                            return (
                                                <Grid key={i} size={{ xs: 6, sm: 4 }}>
                                                    <ImageCard selected={isSelected} onClick={() => toggleSelection(img.src)}>
                                                        <img src={img.src} alt={img.alt || 'Extracted'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                                        <Box className="img-overlay" sx={{ position: 'absolute', inset: 0, bgcolor: isSelected ? 'rgba(6, 182, 212, 0.2)' : 'rgba(0,0,0,0.3)', opacity: isSelected ? 1 : 0, transition: 'all 0.2s', display: 'flex', alignItems: 'start', justifyContent: 'end', p: 1 }}>
                                                            <Box sx={{ width: 20, height: 20, borderRadius: '6px', bgcolor: isSelected ? 'primary.main' : 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                                                {isSelected && <Check size={14} strokeWidth={3} />}
                                                            </Box>
                                                        </Box>
                                                        <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, p: 1, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <Typography variant="caption" sx={{ color: 'white', fontWeight: 700, fontSize: '10px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                                                                {img.naturalWidth}×{img.naturalHeight}
                                                            </Typography>
                                                            <Box sx={{ px: 0.75, py: 0.25, borderRadius: '4px', bgcolor: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)', color: 'white', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase' }}>
                                                                {getExtension(img.src).toUpperCase()}
                                                            </Box>
                                                        </Box>
                                                        <IconButton className="download-btn" size="small" onClick={(e) => downloadImage(img.src, e)} sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'primary.main', color: 'white', opacity: 0, transition: 'all 0.2s', boxShadow: '0 10px 25px -5px rgba(6, 182, 212, 0.5)', '&:hover': { bgcolor: 'primary.dark', transform: 'translate(-50%, -50%) scale(1.1)' } }}>
                                                            <Download size={16} />
                                                        </IconButton>
                                                    </ImageCard>
                                                </Grid>
                                            );
                                        })}
                                    </Grid>
                                    {hasMore && !isExpanded && (
                                        <Button fullWidth variant="outlined" size="small" onClick={() => toggleGroupExpansion(groupName)} sx={{ mt: 3, borderRadius: '12px', borderStyle: 'dashed', borderColor: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.4)', '&:hover': { borderColor: 'primary.main', color: 'primary.main', bgcolor: 'rgba(6, 182, 212, 0.05)' } }}>
                                            Show {groupImgs.length - limit} more
                                        </Button>
                                    )}
                                </Box>
                            );
                        })}
                    </Stack>
                )}
            </Box>

            {/* Float Footer */}
            <Fade in={selected.size > 0}>
                <Box sx={{ position: 'absolute', bottom: 24, left: 24, right: 24, zIndex: 30 }}>
                    <GlassPaper sx={{ p: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.9)', boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.7)' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ width: 32, height: 32, borderRadius: '10px', bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem' }}>
                                {selected.size}
                            </Box>
                            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                                Images selected
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                            <Button onClick={() => setSelected(new Set())} sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'none' }}>
                                Clear
                            </Button>
                            <Button variant="contained" startIcon={downloading ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />} disabled={downloading} onClick={downloadSelected} sx={{ borderRadius: '12px', px: 3, fontWeight: 700, textTransform: 'none', background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', boxShadow: '0 8px 16px -4px rgba(6, 182, 212, 0.4)' }}>
                                {downloading ? 'Packing...' : 'Download'}
                            </Button>
                        </Stack>
                    </GlassPaper>
                </Box>
            </Fade>
        </Box>
    );
}
