import { useTranslation } from 'react-i18next';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, Download, Maximize2 } from 'lucide-react';
import type { FoundImage } from '../../../shared/images/types';
import { imageType, savedSize } from './imageFilters';

/** One image in the grid: click selects (shift-click selects a range), the corner buttons preview and download. */
export function ImageCard({ img, selected, onSelect, onPreview, onDownload }: {
    img: FoundImage;
    selected: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onPreview: () => void;
    onDownload: () => void;
}) {
    const { t } = useTranslation('imageDownloader');
    const size = savedSize(img);
    const type = imageType(img);
    return (
        <Box
            role="checkbox" aria-checked={selected} tabIndex={0} aria-label={img.alt || type || 'image'}
            onClick={onSelect}
            onDoubleClick={onPreview}
            onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onSelect(e as unknown as React.MouseEvent); } if (e.key === 'Enter') onPreview(); }}
            sx={theme => ({
                position: 'relative', aspectRatio: '1', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer',
                contentVisibility: 'auto', containIntrinsicSize: '120px',
                border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: 'action.hover', transition: 'border-color 0.15s',
                outline: 'none', '&:focus-visible': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.4)}` },
                '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled', '& .card-actions': { opacity: 1 } },
                // Transparent images (logos, icons) on a checkerboard.
                backgroundImage: `linear-gradient(45deg, ${theme.palette.action.hover} 25%, transparent 25%, transparent 75%, ${theme.palette.action.hover} 75%)`,
                backgroundSize: '12px 12px',
            })}
        >
            <img src={img.src} alt={img.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} loading="lazy" decoding="async" />
            <Box sx={theme => ({
                position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '5px',
                border: '1.5px solid', borderColor: selected ? 'primary.main' : alpha(theme.palette.common.white, 0.8),
                bgcolor: selected ? 'primary.main' : alpha(theme.palette.common.black, 0.25),
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.contrastText',
            })}>
                {selected && <Check size={12} strokeWidth={3} />}
            </Box>
            <Box className="card-actions" sx={{ position: 'absolute', top: 4, left: 4, display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity 0.15s' }}>
                <Tooltip title={t('preview')}>
                    <IconButton size="small" onClick={e => { e.stopPropagation(); onPreview(); }} sx={{ width: 24, height: 24, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}><Maximize2 size={12} /></IconButton>
                </Tooltip>
                <Tooltip title={t('downloadOne')}>
                    <IconButton size="small" onClick={e => { e.stopPropagation(); onDownload(); }} sx={{ width: 24, height: 24, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}><Download size={12} /></IconButton>
                </Tooltip>
            </Box>
            {/* Size and type over the image: dark whatever the theme, so it reads on any picture. */}
            <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, px: 0.5, py: 0.25, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title={img.full ? t('fullSizeTip', { full: `${img.full.width}×${img.full.height}`, shown: img.width ? `${img.width}×${img.height}` : '?' }) : ''}>
                    <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '8px', whiteSpace: 'nowrap' }}>
                        {img.full && <Box component="span" sx={{ mr: 0.5, px: 0.4, borderRadius: '3px', bgcolor: 'warning.main', color: 'warning.contrastText', fontSize: '7px', fontWeight: 900 }}>HD</Box>}
                        {size.width && size.height ? `${size.width}×${size.height}` : '?'}
                    </Typography>
                </Tooltip>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {!!img.duplicates?.length && (
                        <Tooltip title={t('duplicatesTip', { count: img.duplicates.length })}>
                            <Box sx={{ px: 0.5, borderRadius: '3px', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.18)', fontSize: '7px', fontWeight: 800, color: '#fff' }}>+{img.duplicates.length}</Box>
                        </Tooltip>
                    )}
                    {img.hidden && <Box sx={{ px: 0.5, borderRadius: '3px', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.18)', fontSize: '7px', fontWeight: 800, color: '#fff' }}>{t('hiddenBadge')}</Box>}
                    <Box sx={{ px: 0.5, borderRadius: '3px', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.18)', fontSize: '7px', fontWeight: 800, color: '#fff', textTransform: 'uppercase' }}>{type || '?'}</Box>
                </Box>
            </Box>
        </Box>
    );
}
