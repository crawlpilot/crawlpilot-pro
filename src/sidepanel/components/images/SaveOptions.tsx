import { useTranslation } from 'react-i18next';
import { Box, Chip, FormControlLabel, MenuItem, Select, Slider, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { NAMING_PRESETS } from '../../services/images/naming';
import { FOLDER_ABOVE, type SaveMode } from '../../services/images/save';
import type { OutputFormat, Processing } from '../../services/images/transform';

const MAX_SIDES = [0, 4096, 2048, 1600, 1024, 512];

const label = { color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' } as const;

/** Where saved images go (a zip or a folder) and how their files are named. */
export function SaveOptions({ mode, onMode, template, onTemplate, manifest, onManifest, processing, onProcessing }: {
    mode: SaveMode | 'auto';
    onMode: (m: SaveMode | 'auto') => void;
    template: string;
    onTemplate: (t: string) => void;
    manifest: boolean;
    onManifest: (on: boolean) => void;
    processing: Processing;
    onProcessing: (p: Processing) => void;
}) {
    const { t } = useTranslation('imageDownloader');
    return (
        <Box>
            <Typography variant="caption" sx={label}>{t('saveAs')}</Typography>
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) onMode(v); }} sx={{ mb: 0.5, '& .MuiToggleButton-root': { textTransform: 'none', fontSize: '0.7rem', py: 0.25 } }}>
                <ToggleButton value="auto">{t('modeAuto')}</ToggleButton>
                <ToggleButton value="zip">{t('modeZip')}</ToggleButton>
                <ToggleButton value="folder">{t('modeFolder')}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {mode === 'auto' ? t('modeAutoHint', { count: FOLDER_ABOVE }) : mode === 'folder' ? t('modeFolderHint') : t('modeZipHint')}
            </Typography>
            <Typography variant="caption" sx={label}>{t('fileNames')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75 }}>
                {(Object.keys(NAMING_PRESETS) as (keyof typeof NAMING_PRESETS)[]).map(key => [key, NAMING_PRESETS[key]] as const).map(([key, preset]) => (
                    <Chip key={key} size="small" label={t(`presets.${key}`)} onClick={() => onTemplate(preset.template)}
                        color={template === preset.template ? 'primary' : 'default'} variant={template === preset.template ? 'filled' : 'outlined'}
                        sx={{ borderRadius: '6px', fontSize: '0.65rem', height: 22 }} />
                ))}
            </Box>
            <TextField size="small" fullWidth value={template} onChange={e => onTemplate(e.target.value)}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                helperText={t('templateHelp')} FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.62rem' } }} />
            <Typography variant="caption" sx={{ ...label, mt: 1.5 }}>{t('convert')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={processing.format} onChange={(_, v: OutputFormat | null) => { if (v) onProcessing({ ...processing, format: v }); }}
                    sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontSize: '0.7rem', py: 0.25 } }}>
                    <ToggleButton value="original">{t('formatOriginal')}</ToggleButton>
                    <ToggleButton value="jpeg">JPG</ToggleButton>
                    <ToggleButton value="png">PNG</ToggleButton>
                    <ToggleButton value="webp">WebP</ToggleButton>
                </ToggleButtonGroup>
                <Select size="small" value={processing.maxSide} onChange={e => onProcessing({ ...processing, maxSide: Number(e.target.value) })} sx={{ fontSize: '0.7rem', height: 28 }} aria-label={t('maxSide')}>
                    {MAX_SIDES.map(n => <MenuItem key={n} value={n} sx={{ fontSize: '0.75rem' }}>{n ? t('maxSideN', { n }) : t('fullResolution')}</MenuItem>)}
                </Select>
            </Box>
            {(processing.format === 'jpeg' || processing.format === 'webp') && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5, pr: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{t('quality', { n: Math.round(processing.quality * 100) })}</Typography>
                    <Slider size="small" min={0.5} max={1} step={0.05} value={processing.quality} onChange={(_, v) => onProcessing({ ...processing, quality: v as number })} aria-label={t('quality', { n: '' })} />
                </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {processing.format === 'original' && !processing.maxSide ? t('convertNone') : t('convertHint')}
            </Typography>
            <FormControlLabel sx={{ ml: 0, mt: 0.5 }} control={<Switch size="small" checked={manifest} onChange={e => onManifest(e.target.checked)} />}
                label={<Typography variant="caption" fontWeight={600}>{t('withManifest')}</Typography>} />
        </Box>
    );
}
