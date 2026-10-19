import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import type { ImageFilters } from './imageFilters';

const label = { color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' } as const;
const chip = { borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700, height: 22 } as const;
const small = { '& .MuiInputBase-root': { fontSize: '0.72rem', height: 30 } } as const;

const TYPES = ['jpg', 'png', 'webp', 'avif', 'gif', 'svg'];
const SIZES = ['small', 'medium', 'large'] as const;
const ASPECTS = ['square', 'portrait', 'landscape', 'banner'] as const;

/** Every filter: type, size, shape, host, URL patterns, icons and hidden images. Kept per site. */
export function FiltersPanel({ filters, update, toggle, reset, domains, children }: {
    filters: ImageFilters;
    update: <K extends keyof ImageFilters>(key: K, value: ImageFilters[K]) => void;
    toggle: (key: 'fileTypes' | 'sizeCategories' | 'aspects' | 'domains', value: string) => void;
    reset: () => void;
    domains: [string, number][];
    children?: React.ReactNode;
}) {
    const { t } = useTranslation('imageDownloader');
    const num = (key: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight', placeholder: string) => (
        <TextField size="small" placeholder={placeholder} value={filters[key]} sx={{ width: 76, ...small }}
            inputProps={{ inputMode: 'numeric', 'aria-label': placeholder }}
            onChange={e => { const digits = e.target.value.replace(/\D/g, ''); update(key, digits ? Number(digits) : ''); }} />
    );
    return (
        <Stack spacing={1.5} sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <Box>
                <Typography variant="caption" sx={label}>{t('format')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {TYPES.map(type => <Chip key={type} label={type} size="small" sx={chip} onClick={() => toggle('fileTypes', type)}
                        color={filters.fileTypes.has(type) ? 'primary' : 'default'} variant={filters.fileTypes.has(type) ? 'filled' : 'outlined'} />)}
                </Box>
            </Box>
            <Box>
                <Typography variant="caption" sx={label}>{t('size')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {SIZES.map(s => <Chip key={s} label={t(`sizes.${s}`)} size="small" sx={chip} onClick={() => toggle('sizeCategories', s)}
                        color={filters.sizeCategories.has(s) ? 'primary' : 'default'} variant={filters.sizeCategories.has(s) ? 'filled' : 'outlined'} />)}
                    {ASPECTS.map(a => <Chip key={a} label={t(`aspects.${a}`)} size="small" sx={chip} onClick={() => toggle('aspects', a)}
                        color={filters.aspects.has(a) ? 'primary' : 'default'} variant={filters.aspects.has(a) ? 'filled' : 'outlined'} />)}
                </Box>
            </Box>
            <Box>
                <Typography variant="caption" sx={label}>{t('dimensions')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                    {num('minWidth', t('minW'))}{num('maxWidth', t('maxW'))}
                    <Typography variant="caption" color="text.secondary">×</Typography>
                    {num('minHeight', t('minH'))}{num('maxHeight', t('maxH'))}
                </Box>
            </Box>
            {domains.length > 1 && (
                <Box>
                    <Typography variant="caption" sx={label}>{t('hosts')}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {domains.slice(0, 12).map(([d, n]) => <Chip key={d} label={`${d} · ${n}`} size="small" sx={chip} onClick={() => toggle('domains', d)}
                            color={filters.domains.has(d) ? 'primary' : 'default'} variant={filters.domains.has(d) ? 'filled' : 'outlined'} />)}
                    </Box>
                </Box>
            )}
            <Box>
                <Typography variant="caption" sx={label}>{t('urls')}</Typography>
                <Stack direction="row" spacing={0.5}>
                    <TextField size="small" fullWidth placeholder={t('includePattern')} value={filters.include} onChange={e => update('include', e.target.value)} sx={small} />
                    <TextField size="small" fullWidth placeholder={t('excludePattern')} value={filters.exclude} onChange={e => update('exclude', e.target.value)} sx={small} />
                </Stack>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
                <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={filters.hideIcons} onChange={e => update('hideIcons', e.target.checked)} />}
                    label={<Typography variant="caption" fontWeight={600}>{t('hideIcons')}</Typography>} />
                <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={filters.includeHidden} onChange={e => update('includeHidden', e.target.checked)} />}
                    label={<Typography variant="caption" fontWeight={600}>{t('includeHidden')}</Typography>} />
            </Box>
            {children}
            <Box><Button size="small" onClick={reset}>{t('resetFilters')}</Button></Box>
        </Stack>
    );
}
