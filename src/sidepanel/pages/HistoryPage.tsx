/**
 * My data (docs/plans/ux-simplification-plan.md §4.5): everything the user has scraped, one card each,
 * with what they do next: open it, download it, run it again.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Database, RefreshCcw, Search, Table2, X } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { Button, Dialog, EmptyState, IconButton, Segmented, Spinner, Stack, Text, TextField } from '../ui';
import { RecipeCard } from '../components/history/RecipeCard';
import { SiteSettingsCard } from '../components/sites/SiteSettingsCard';
import { recipeEntries, type RecipeEntry } from '../components/history/recipes';
import { READY_MADE } from '@/shared/recipes/readyMade';
import { specHash } from '@/shared/recipes/spec';
import { useJobHistory } from '../hooks/useDatabase';
import { useJobRerun } from '../hooks/useJobRerun';
import type { JobWithRecipe } from '../components/history/jobFilters';
import { DataCard } from '../components/history/DataCard';
import { dataEntries, searchEntries, type DataEntry } from '../components/history/myData';
import { RunDialog, runTargetOf, type RunTarget } from '../components/history/RunDialog';
import { JobDetailsDialog } from '../components/history/JobDetailsDialog';
import { db } from '@/shared/db';
import type { Table } from '@/shared/types/database';
import type { RecipeRuns } from '@/shared/db';
import { downloadTableCsv } from '../services/download';

interface HistoryPageProps {
    onBack: () => void;
    onViewData: (tableId: number) => void;
}

/** Above this many, a search box helps. */
const SEARCH_FROM = 5;

/** A ready-made recipe as a card shows it: not run yet. */
const readyEntry = (r: (typeof READY_MADE)[number]): RecipeEntry => ({
    recipe: { name: r.name, spec: r.spec, hash: '', rev: 1, createdAt: 0, updatedAt: 0 },
    kind: r.spec.kind, site: r.site, runs: 0, notes: [],
});

export default function HistoryPage({ onBack, onViewData }: HistoryPageProps) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const { jobs, loading: jobsLoading, refresh: refreshJobs, deleteJob } = useJobHistory();
    const [tables, setTables] = useState<Table[] | null>(null);
    const [query, setQuery] = useState('');
    const [detailsJob, setDetailsJob] = useState<JobWithRecipe | null>(null);
    const [runTarget, setRunTarget] = useState<RunTarget | null>(null);
    /** Data: one card per table. Recipes: one card per recipe, with how its last run went. */
    const [tab, setTab] = useState<'data' | 'recipes'>('data');
    const [savedRecipes, setSavedRecipes] = useState<RecipeRuns[]>([]);
    const recipes = useMemo(() => recipeEntries(savedRecipes), [savedRecipes]);
    /** Ready-made recipes not saved yet: once run, each is one of the user's recipes. */
    const readyMade = useMemo(() => {
        const saved = new Set(savedRecipes.map(r => r.recipe.hash));
        return READY_MADE.filter(r => !saved.has(specHash(r.spec)));
    }, [savedRecipes]);
    /** The recipe being named: renamed, or a run's recipe saved to the Recipes screen. */
    const [renaming, setRenaming] = useState<{ id: number; name: string; save?: boolean } | null>(null);
    const [siteFor, setSiteFor] = useState<string | null>(null);

    const loadTables = useCallback(() => db.tables.list(500).then(setTables).catch(() => setTables([])), []);
    const loadRecipes = useCallback(() => db.jobs.listRecipes().then(setSavedRecipes).catch(() => setSavedRecipes([])), []);
    const refresh = useCallback(() => { void refreshJobs(); void loadTables(); void loadRecipes(); }, [refreshJobs, loadTables, loadRecipes]);
    useEffect(() => { void loadTables(); void loadRecipes(); }, [loadTables, loadRecipes]);

    const runJob = (job: JobWithRecipe) => {
        const target = runTargetOf(job);
        if (target) setRunTarget(target);
        else alert("This job's recipe is gone, so it can't be re-run.");
    };

    const { rerun, stop, busy, bulkDone } = useJobRerun({ onStarted: () => refresh(), onFinished: () => refresh() });
    useEffect(() => {
        if (bulkDone) refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bulkDone]);

    const entries = useMemo(() => (tables ? dataEntries(tables, jobs) : []), [tables, jobs]);
    const shown = useMemo(() => searchEntries(entries, query), [entries, query]);

    const remove = async (entry: DataEntry) => {
        if (!confirm(t('removeConfirm', { name: entry.name || t('untitledJob') }))) return;
        // Every run that wrote this table goes with it (removing a run removes its table).
        const runs = jobs.filter(j => j.id !== undefined && (j.id === entry.job?.id || (entry.table?.id !== undefined && j.tableId === entry.table.id)));
        for (const run of runs) await deleteJob(run.id!);
        if (entry.table?.id !== undefined && runs.length === 0) await db.tables.remove(entry.table.id);
        refresh();
    };

    if (jobsLoading || tables === null) return (
        <div className="flex h-full items-center justify-center text-ink-2"><Spinner size={28} label={t('title')} /></div>
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={t('title')} subtitle={entries.length ? t('jobsFound', { count: entries.length }) : undefined} onBack={onBack}
                actions={<>
                    <Button size="sm" variant="ghost" icon={<Table2 />} onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?view=data-table') })}>
                        {t('allTables')}
                    </Button>
                    <IconButton label={t('refresh')} onClick={refresh}><RefreshCcw /></IconButton>
                </>}>
                <Segmented tabs fullWidth size="sm" className="mt-3" aria-label={t('title')} value={tab} onChange={setTab}
                    options={[{ value: 'data', label: t('tabs.data') }, { value: 'recipes', label: t('tabs.recipes') }]} />
                {tab === 'data' && entries.length >= SEARCH_FROM && (
                    <TextField size="sm" className="mt-3" placeholder={t('searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)}
                        start={<Search />}
                        end={query && <IconButton size="sm" label="Clear" noTooltip onClick={() => setQuery('')}><X /></IconButton>} />
                )}
            </ToolHeader>

            <div className="flex-1 overflow-y-auto p-4">
                {tab === 'recipes' ? (
                    <Stack gap={2.5}>
                        {readyMade.length > 0 && <Text size="caption" weight="semibold" tone="muted">{t('recipes.readyMade')}</Text>}
                        {readyMade.map(r => (
                            <RecipeCard key={r.key} entry={readyEntry(r)} busy={busy}
                                onRun={() => setRunTarget({ name: r.name, spec: r.spec, pages: r.pages, readyMade: true })} />
                        ))}
                        {readyMade.length > 0 && recipes.length > 0 && <Text size="caption" weight="semibold" tone="muted" className="mt-2">{t('recipes.mine')}</Text>}
                        {recipes.map(r => (
                            <RecipeCard key={r.recipe.id} entry={r} busy={busy}
                                onRun={() => setRunTarget({ name: r.recipe.name, spec: r.recipe.spec, job: r.last, pages: r.last?.input?.urls ?? [] })}
                                onOpen={r.lastWithData?.tableId !== undefined ? () => onViewData(r.lastWithData!.tableId!) : undefined}
                                onRename={() => setRenaming({ id: r.recipe.id!, name: r.recipe.name })}
                                onSiteSettings={() => setSiteFor(r.site)}
                                onUnsave={() => void db.jobs.setRecipeSaved(r.recipe.id!, false).then(refresh)} />
                        ))}
                        {recipes.length === 0 && (
                            <EmptyState className="mt-6" icon={<BookOpen />} title={t('recipes.empty')}>{t('recipes.emptyHint')}</EmptyState>
                        )}
                    </Stack>
                ) : shown.length > 0 ? (
                    <Stack gap={2.5}>
                        {shown.map(entry => (
                            <DataCard key={entry.key} entry={entry} busy={busy}
                                onOpen={() => entry.table?.id !== undefined && onViewData(entry.table.id)}
                                onDownload={() => (entry.table ? downloadTableCsv(entry.table) : Promise.resolve())}
                                onRerun={entry.job ? () => runJob(entry.job!) : undefined}
                                onStop={entry.job ? () => stop(entry.job!) : undefined}
                                onDetails={entry.job ? () => setDetailsJob(entry.job!) : undefined}
                                onSaveRecipe={entry.job?.recipe?.id !== undefined && !entry.job.recipe.saved
                                    ? () => setRenaming({ id: entry.job!.recipe!.id!, name: entry.job!.recipe!.name, save: true }) : undefined}
                                onRemove={() => void remove(entry)} />
                        ))}
                    </Stack>
                ) : entries.length === 0 ? (
                    <EmptyState className="mt-10" icon={<Database />} title={t('noJobsFound')}
                        action={<Button variant="primary" onClick={onBack}>{t('startFirst')}</Button>}>{t('noJobsYet')}</EmptyState>
                ) : (
                    <EmptyState className="mt-10" icon={<Search />} title={t('noMatches')}>{t('noSearchResults')}</EmptyState>
                )}
            </div>

            <Dialog open={!!renaming} onClose={() => setRenaming(null)} size="sm" title={renaming?.save ? t('recipes.saveAs') : t('recipes.renameTitle')}
                description={renaming?.save ? t('recipes.saveAsHint') : undefined}
                actions={<>
                    <Button variant="ghost" onClick={() => setRenaming(null)}>{tc('cancel')}</Button>
                    <Button variant="primary" onClick={() => {
                        const r = renaming;
                        setRenaming(null);
                        if (r) void (r.save ? db.jobs.setRecipeSaved(r.id, true, r.name) : db.jobs.renameRecipe(r.id, r.name)).then(refresh);
                    }}>{t('recipes.save')}</Button>
                </>}>
                <TextField label={t('runName')} value={renaming?.name ?? ''} onChange={e => setRenaming(prev => (prev ? { ...prev, name: e.target.value } : prev))} autoFocus />
            </Dialog>

            <Dialog open={!!siteFor} onClose={() => setSiteFor(null)} size="sm" title={t('recipes.siteSettings')}
                actions={<Button variant="primary" onClick={() => setSiteFor(null)}>{tc('close', { defaultValue: 'Close' })}</Button>}>
                {siteFor && <SiteSettingsCard site={siteFor} />}
            </Dialog>

            <RunDialog target={runTarget} onClose={() => setRunTarget(null)}
                onStart={(target, options) => { setRunTarget(null); void rerun(target, options); }} />
            <JobDetailsDialog detailsJob={detailsJob} onClose={() => setDetailsJob(null)}
                onDelete={id => { void Promise.resolve(deleteJob(id)).then(refresh); }}
                onRerun={runJob} />
        </div>
    );
}
