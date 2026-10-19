/**
 * My data (docs/plans/ux-simplification-plan.md §4.5): everything the user has scraped, one card each,
 * with what they do next: open it, download it, run it again.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, RefreshCcw, Search, Table2, X } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { Button, EmptyState, IconButton, Spinner, Stack, TextField } from '../ui';
import { useJobHistory } from '../hooks/useDatabase';
import { useJobRerun } from '../hooks/useJobRerun';
import type { JobWithRecipe } from '../components/history/jobFilters';
import { DataCard } from '../components/history/DataCard';
import { dataEntries, searchEntries, type DataEntry } from '../components/history/myData';
import { RerunDialog } from '../components/history/RerunDialog';
import { JobDetailsDialog } from '../components/history/JobDetailsDialog';
import { db } from '@/shared/db';
import type { Table } from '@/shared/types/database';
import { downloadTableCsv } from '../services/download';

interface HistoryPageProps {
    onBack: () => void;
    onViewData: (tableId: number) => void;
}

/** Above this many, a search box helps. */
const SEARCH_FROM = 5;

export default function HistoryPage({ onBack, onViewData }: HistoryPageProps) {
    const { t } = useTranslation('history');
    const { jobs, loading: jobsLoading, refresh: refreshJobs, deleteJob } = useJobHistory();
    const [tables, setTables] = useState<Table[] | null>(null);
    const [query, setQuery] = useState('');
    const [detailsJob, setDetailsJob] = useState<JobWithRecipe | null>(null);
    const [rerunTarget, setRerunTarget] = useState<JobWithRecipe | null>(null);

    const loadTables = useCallback(() => db.tables.list(500).then(setTables).catch(() => setTables([])), []);
    const refresh = useCallback(() => { void refreshJobs(); void loadTables(); }, [refreshJobs, loadTables]);
    useEffect(() => { void loadTables(); }, [loadTables]);

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
                {entries.length >= SEARCH_FROM && (
                    <TextField size="sm" className="mt-3" placeholder={t('searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)}
                        start={<Search />}
                        end={query && <IconButton size="sm" label="Clear" noTooltip onClick={() => setQuery('')}><X /></IconButton>} />
                )}
            </ToolHeader>

            <div className="flex-1 overflow-y-auto p-4">
                {shown.length > 0 ? (
                    <Stack gap={2.5}>
                        {shown.map(entry => (
                            <DataCard key={entry.key} entry={entry} busy={busy}
                                onOpen={() => entry.table?.id !== undefined && onViewData(entry.table.id)}
                                onDownload={() => (entry.table ? downloadTableCsv(entry.table) : Promise.resolve())}
                                onRerun={entry.job ? () => setRerunTarget(entry.job!) : undefined}
                                onStop={entry.job ? () => stop(entry.job!) : undefined}
                                onDetails={entry.job ? () => setDetailsJob(entry.job!) : undefined}
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

            <RerunDialog job={rerunTarget} onClose={() => setRerunTarget(null)}
                onStart={(job, options) => { setRerunTarget(null); void rerun(job, options); }} />
            <JobDetailsDialog detailsJob={detailsJob} onClose={() => setDetailsJob(null)}
                onDelete={id => { void Promise.resolve(deleteJob(id)).then(refresh); }}
                onRerun={job => setRerunTarget(job)} />
        </div>
    );
}
