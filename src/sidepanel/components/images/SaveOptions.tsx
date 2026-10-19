import { useTranslation } from 'react-i18next';
import { Box, Chip, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { NAMING_PRESETS } from '../../services/images/naming';
import { FOLDER_ABOVE, type SaveMode } from '../../services/images/save';

const label = { color: 'text.secondary', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' } as const;

/** Where saved images go (a zip or a folder) and how their files are named. */
export function SaveOptions({ mode, onMode, template, onTemplate }: {
    mode: SaveMode | 'auto';
    onMode: (m: SaveMode | 'auto') => void;
    template: string;
    onTemplate: (t: string) => void;
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
                {Object.entries(NAMING_PRESETS).map(([key, preset]) => (
                    <Chip key={key} size="small" label={preset.label} onClick={() => onTemplate(preset.template)}
                        color={template === preset.template ? 'primary' : 'default'} variant={template === preset.template ? 'filled' : 'outlined'}
                        sx={{ borderRadius: '6px', fontSize: '0.65rem', height: 22 }} />
                ))}
            </Box>
            <TextField size="small" fullWidth value={template} onChange={e => onTemplate(e.target.value)}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                helperText={t('templateHelp')} FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.62rem' } }} />
        </Box>
    );
}
