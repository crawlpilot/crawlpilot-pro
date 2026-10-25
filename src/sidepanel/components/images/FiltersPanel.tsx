import { useTranslation } from 'react-i18next';
import { Button, Switch, TextField, ToggleChip } from '../../ui';
import type { ImageFilters } from './imageFilters';

const TYPES = ['jpg', 'png', 'webp', 'avif', 'gif', 'svg'];
const SIZES = ['small', 'medium', 'large'] as const;
const ASPECTS = ['square', 'portrait', 'landscape', 'banner'] as const;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-1.5 text-caption font-semibold text-ink-2">{label}</div>
            {children}
        </div>
    );
}

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
        <TextField size="sm" className="w-[76px]" placeholder={placeholder} value={filters[key]} inputMode="numeric" aria-label={placeholder}
            onChange={e => { const digits = e.target.value.replace(/\D/g, ''); update(key, digits ? Number(digits) : ''); }} />
    );
    return (
        <div className="mt-3 flex flex-col gap-3.5 border-t border-line pt-3">
            <Group label={t('format')}>
                <div className="flex flex-wrap gap-1">
                    {TYPES.map(type => <ToggleChip key={type} selected={filters.fileTypes.has(type)} onClick={() => toggle('fileTypes', type)}>{type}</ToggleChip>)}
                </div>
            </Group>
            <Group label={t('size')}>
                <div className="flex flex-wrap gap-1">
                    {SIZES.map(s => <ToggleChip key={s} selected={filters.sizeCategories.has(s)} onClick={() => toggle('sizeCategories', s)}>{t(`sizes.${s}`)}</ToggleChip>)}
                    {ASPECTS.map(a => <ToggleChip key={a} selected={filters.aspects.has(a)} onClick={() => toggle('aspects', a)}>{t(`aspects.${a}`)}</ToggleChip>)}
                </div>
            </Group>
            <Group label={t('dimensions')}>
                <div className="flex flex-wrap items-center gap-1">
                    {num('minWidth', t('minW'))}{num('maxWidth', t('maxW'))}
                    <span className="text-caption text-ink-3">×</span>
                    {num('minHeight', t('minH'))}{num('maxHeight', t('maxH'))}
                </div>
            </Group>
            {domains.length > 1 && (
                <Group label={t('hosts')}>
                    <div className="flex flex-wrap gap-1">
                        {domains.slice(0, 12).map(([d, n]) => <ToggleChip key={d} selected={filters.domains.has(d)} count={n} onClick={() => toggle('domains', d)}>{d}</ToggleChip>)}
                    </div>
                </Group>
            )}
            <Group label={t('urls')}>
                <div className="flex gap-1.5">
                    <TextField size="sm" className="flex-1" placeholder={t('includePattern')} value={filters.include} onChange={e => update('include', e.target.value)} />
                    <TextField size="sm" className="flex-1" placeholder={t('excludePattern')} value={filters.exclude} onChange={e => update('exclude', e.target.value)} />
                </div>
            </Group>
            <div className="flex flex-col gap-2.5">
                <Switch checked={filters.hideIcons} onChange={v => update('hideIcons', v)} label={t('hideIcons')} />
                <Switch checked={filters.includeHidden} onChange={v => update('includeHidden', v)} label={t('includeHidden')} />
            </div>
            {children}
            <div><Button size="sm" variant="ghost" onClick={reset}>{t('resetFilters')}</Button></div>
        </div>
    );
}
