/**
 * My data (docs/plans/ux-simplification-plan.md §4.5): everything the user has scraped, one card each,
 * with what they do next: open it, download it, run it again.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, RefreshCcw, Search, Table2, X } from 'lucide-react';
import { Box, Button, CircularProgress, IconButton, InputAdornment, Stack, TextField, Tooltip } from '@mui/material';
import ToolHeader from '../components/ui/ToolHeader';
import EmptyState from '../components/ui/EmptyState';
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
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={32} />
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <ToolHeader title={t('title')} subtitle={entries.length ? t('jobsFound', { count: entries.length }) : undefined} onBack={onBack}
                actions={<>
                    <Button size="small" startIcon={<Table2 size={14} />} onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?view=data-table') })}>
                        {t('allTables')}
                    </Button>
                    <Tooltip title={t('refresh')}>
                        <IconButton onClick={refresh} size="small" aria-label={t('refresh')}><RefreshCcw size={16} /></IconButton>
                    </Tooltip>
                </>}>
                {entries.length >= SEARCH_FROM && (
                    <TextField fullWidth size="small" placeholder={t('searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} sx={{ mt: 1.25 }}
                        InputProps={{
                            startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment>,
                            endAdornment: query && <InputAdornment position="end"><IconButton size="small" onClick={() => setQuery('')} aria-label="Clear"><X size={14} /></IconButton></InputAdornment>,
                        }} />
                )}
            </ToolHeader>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                {shown.length > 0 ? (
                    <Stack spacing={1}>
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
                ) : (
                    <Box sx={{ mt: 8 }}>
                        {entries.length === 0 ? (
                            <EmptyState title={t('noJobsFound')} description={t('noJobsYet')}
                                icon={<Database size={40} style={{ opacity: 0.4 }} />}
                                action={<Button variant="contained" onClick={onBack}>{t('startFirst')}</Button>} />
                        ) : (
                            <EmptyState title={t('noMatches')} description={t('noSearchResults')} icon={<Search size={40} style={{ opacity: 0.4 }} />} />
                        )}
                    </Box>
                )}
            </Box>

            <RerunDialog job={rerunTarget} onClose={() => setRerunTarget(null)}
                onStart={(job, options) => { setRerunTarget(null); void rerun(job, options); }} />
            <JobDetailsDialog detailsJob={detailsJob} onClose={() => setDetailsJob(null)}
                onDelete={id => { void Promise.resolve(deleteJob(id)).then(refresh); }}
                onRerun={job => setRerunTarget(job)} />
        </Box>
    );
}
