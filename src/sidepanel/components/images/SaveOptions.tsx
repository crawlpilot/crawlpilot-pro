import { useTranslation } from 'react-i18next';
import { Segmented, Select, Slider, Switch, Text, TextField, ToggleChip } from '../../ui';
import { NAMING_PRESETS } from '../../services/images/naming';
import { FOLDER_ABOVE, type SaveMode } from '../../services/images/save';
import type { OutputFormat, Processing } from '../../services/images/transform';

const MAX_SIDES = [0, 4096, 2048, 1600, 1024, 512];

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={`mb-1.5 text-caption font-semibold text-ink-2 ${className ?? ''}`}>{children}</div>;
}

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
        <div>
            <Label>{t('saveAs')}</Label>
            <Segmented size="sm" aria-label={t('saveAs')} value={mode} onChange={onMode}
                options={[{ value: 'auto', label: t('modeAuto') }, { value: 'zip', label: t('modeZip') }, { value: 'folder', label: t('modeFolder') }]} />
            <Text size="caption" tone="muted" className="mt-1 mb-3">
                {mode === 'auto' ? t('modeAutoHint', { count: FOLDER_ABOVE }) : mode === 'folder' ? t('modeFolderHint') : t('modeZipHint')}
            </Text>

            <Label>{t('fileNames')}</Label>
            <div className="mb-2 flex flex-wrap gap-1">
                {(Object.keys(NAMING_PRESETS) as (keyof typeof NAMING_PRESETS)[]).map(key => (
                    <ToggleChip key={key} selected={template === NAMING_PRESETS[key].template} onClick={() => onTemplate(NAMING_PRESETS[key].template)}>
                        {t(`presets.${key}`)}
                    </ToggleChip>
                ))}
            </div>
            <TextField size="sm" inputClassName="font-mono" value={template} onChange={e => onTemplate(e.target.value)} hint={t('templateHelp')} aria-label={t('fileNames')} />

            <Label className="mt-3.5">{t('convert')}</Label>
            <div className="flex flex-wrap items-center gap-2">
                <Segmented size="sm" aria-label={t('convert')} value={processing.format} onChange={(v: OutputFormat) => onProcessing({ ...processing, format: v })}
                    options={[{ value: 'original', label: t('formatOriginal') }, { value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
                <Select size="sm" aria-label={t('maxSide')} value={processing.maxSide} onChange={v => onProcessing({ ...processing, maxSide: v })}
                    options={MAX_SIDES.map(n => ({ value: n, label: n ? t('maxSideN', { n }) : t('fullResolution') }))} />
            </div>
            {(processing.format === 'jpeg' || processing.format === 'webp') && (
                <Slider className="mt-2.5" min={0.5} max={1} step={0.05} value={processing.quality} onChange={v => onProcessing({ ...processing, quality: v })}
                    label={t('quality', { n: '' })} valueLabel={`${Math.round(processing.quality * 100)}%`} />
            )}
            <Text size="caption" tone="muted" className="mt-1.5 mb-3">
                {processing.format === 'original' && !processing.maxSide ? t('convertNone') : t('convertHint')}
            </Text>
            <Switch checked={manifest} onChange={onManifest} label={t('withManifest')} />
        </div>
    );
}
