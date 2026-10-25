/** One recipe on the Recipes screen: what it reads, from where, how its last run went (or that it hasn't run), and Run / Open / Rename. */
import { useTranslation } from 'react-i18next';
import { BookOpen, Gauge, Pencil, RefreshCcw } from 'lucide-react';
import { Button, Chip, IconButton, Text, Tooltip, type ChipTone } from '../../ui';
import { ago } from './DataCard';
import type { Health, RecipeEntry } from './recipes';

const TONE: Record<Health, ChipTone> = { good: 'success', warn: 'warning', bad: 'danger', running: 'info' };

interface Props {
    entry: RecipeEntry;
    busy: boolean;
    onRun: () => void;
    onOpen?: () => void;
    onRename?: () => void;
    onSiteSettings?: () => void;
}

export function RecipeCard({ entry, busy, onRun, onOpen, onRename, onSiteSettings }: Props) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const rows = entry.last?.stats?.itemsExtracted ?? 0;
    const fields = entry.recipe.spec.kind === 'page' ? entry.recipe.spec.elements.filter(e => e.action !== 'click').length : 0;
    return (
        <div className="rounded-card border border-line bg-surface p-3.5" data-testid="recipe-card">
            <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-mint text-ink"><BookOpen size={17} /></span>
                <div className="min-w-0 flex-1">
                    <Text weight="semibold" truncate title={entry.recipe.name}>{entry.recipe.name}</Text>
                    <Text size="caption" tone="faint" truncate>
                        {entry.site || t('unknownSite')} · {t(`recipes.kind.${entry.kind}`, { defaultValue: entry.kind })} · {t('recipes.runs', { count: entry.runs })}
                    </Text>
                    <Text size="caption" tone="muted" truncate>
                        {entry.last ? t('recipes.lastRun', { when: ago(entry.last.createdAt, tc), count: rows })
                            : fields ? `${t('recipes.notRunYet')} · ${t('recipes.fields', { count: fields })}` : t('recipes.notRunYet')}
                    </Text>
                </div>
                {entry.health && <Chip tone={TONE[entry.health]}>{t(`recipes.health.${entry.health}`)}</Chip>}
                {onRename && <IconButton size="sm" label={t('recipes.rename')} onClick={onRename} className="-mt-0.5 -mr-1.5"><Pencil /></IconButton>}
            </div>
            {entry.notes.length > 0 && (
                <ul className="mt-2 ml-12 list-disc pl-4 text-caption text-ink-2" data-testid="recipe-notes">
                    {entry.notes.map(n => <li key={n}>{n}</li>)}
                </ul>
            )}
            <div className="mt-3 ml-12 flex flex-wrap gap-1.5">
                <Tooltip title={busy ? tc('loading') : ''}>
                    <span><Button size="sm" variant="primary" disabled={busy || entry.health === 'running'} icon={<RefreshCcw />} onClick={onRun}>{t('recipes.run')}</Button></span>
                </Tooltip>
                {onOpen && <Button size="sm" onClick={onOpen}>{t('recipes.openData')}</Button>}
                {onSiteSettings && entry.site && <Button size="sm" variant="ghost" icon={<Gauge />} onClick={onSiteSettings}>{t('recipes.siteSettings')}</Button>}
            </div>
        </div>
    );
}
