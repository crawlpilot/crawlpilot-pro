import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight, Copy, Crosshair, Download, ExternalLink, Image as ImageIcon, X } from 'lucide-react';
import type { FoundImage } from '../../../shared/images/types';
import { imageType, savedSize, savedSrc } from './imageFilters';

/**
 * One image large, with what is known about it, and actions: show it on the page, open the
 * original, copy its URL or the image itself, download it. Arrow keys step through the list.
 */
export function ImageLightbox({ images, index, onIndex, onClose, onShowOnPage, onDownload, onCopyImage }: {
    images: FoundImage[];
    index: number;
    onIndex: (i: number) => void;
    onClose: () => void;
    onShowOnPage: (img: FoundImage) => Promise<string | null>;
    onDownload: (img: FoundImage) => void;
    onCopyImage: (img: FoundImage) => Promise<string | null>;
}) {
    const { t } = useTranslation('imageDownloader');
    const img = images[index];
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => { setNote(null); }, [index]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
            if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [index, images.length, onIndex]);

    if (!img) return null;
    const size = savedSize(img);
    const src = savedSrc(img);
    const rows: [string, string | undefined][] = [
        [t('detailSize'), size.width ? `${size.width}×${size.height}${img.full && img.width ? ` (${t('shownAt', { size: `${img.width}×${img.height}` })})` : ''}` : undefined],
        [t('detailType'), imageType(img).toUpperCase() || undefined],
        [t('detailAlt'), img.alt],
        [t('detailCaption'), img.caption],
        [t('detailSection'), img.heading],
        [t('detailFound'), t(`origin.${img.origin}`)],
        [t('detailUrl'), src.startsWith('data:') ? t('inlineImage') : src],
    ];
    const run = async (action: () => Promise<string | null>, success: string) => setNote((await action()) ?? success);

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: { m: 1, width: 'calc(100% - 16px)', maxHeight: 'calc(100% - 16px)' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', gap: 1 }}>
                <ImageIcon size={16} />
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('previewOf', { n: index + 1, total: images.length })}</Typography>
                <IconButton size="small" onClick={onClose} aria-label={t('close')}><X size={16} /></IconButton>
            </Box>
            <Box sx={{ position: 'relative', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                <img src={src} alt={img.alt || ''} style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', display: 'block' }} />
                <IconButton disabled={index === 0} onClick={() => onIndex(index - 1)} sx={{ position: 'absolute', left: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }} aria-label={t('previous')}><ChevronLeft size={18} /></IconButton>
                <IconButton disabled={index === images.length - 1} onClick={() => onIndex(index + 1)} sx={{ position: 'absolute', right: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }} aria-label={t('next')}><ChevronRight size={18} /></IconButton>
            </Box>
            <Box sx={{ p: 1.5, overflowY: 'auto' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '90px 1fr', columnGap: 1, rowGap: 0.5, mb: 1.5 }}>
                    {rows.filter(([, v]) => v).map(([k, v]) => [
                        <Typography key={`${k}-k`} variant="caption" color="text.secondary" fontWeight={600}>{k}</Typography>,
                        <Typography key={`${k}-v`} variant="caption" sx={{ wordBreak: 'break-all' }}>{v}</Typography>,
                    ])}
                </Box>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
                    <Button size="small" variant="contained" startIcon={<Download size={14} />} onClick={() => onDownload(img)}>{t('downloadOne')}</Button>
                    <Button size="small" variant="outlined" startIcon={<Crosshair size={14} />} onClick={() => run(() => onShowOnPage(img), t('shownOnPage'))}>{t('showOnPage')}</Button>
                    {!src.startsWith('data:') && <Button size="small" variant="outlined" startIcon={<ExternalLink size={14} />} onClick={() => chrome.tabs.create({ url: src })}>{t('openOriginal')}</Button>}
                    <Tooltip title={src.startsWith('data:') ? '' : src}>
                        <Button size="small" variant="text" startIcon={<Copy size={14} />} onClick={() => run(async () => { await navigator.clipboard.writeText(src); return null; }, t('copiedUrl'))}>{t('copyUrl')}</Button>
                    </Tooltip>
                    <Button size="small" variant="text" startIcon={<Copy size={14} />} onClick={() => run(() => onCopyImage(img), t('copiedImage'))}>{t('copyImage')}</Button>
                </Stack>
                {note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{note}</Typography>}
            </Box>
        </Dialog>
    );
}
