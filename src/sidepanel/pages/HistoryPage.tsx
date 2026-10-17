import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, Database, PauseCircle, Play, RefreshCcw, Search, X, XCircle } from 'lucide-react';
import { AppBar, Box, Chip, CircularProgress, IconButton, InputAdornment, Stack, TextField, Toolbar, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import EmptyState from '../components/ui/EmptyState';
import { useJobHistory } from '../hooks/useDatabase';
import { useJobRerun } from '../hooks/useJobRerun';
import { filterJobs, FilterStatus, jobCounts, JobWithRecipe } from '../components/history/jobFilters';
import { JobCard } from '../components/history/JobCard';
import { RerunDialog } from '../components/history/RerunDialog';
import { JobDetailsDialog } from '../components/history/JobDetailsDialog';

interface HistoryPageProps {
    onBack: () => void;
    onViewData: (tableId: number) => void;
}

export default function HistoryPage({ onViewData }: HistoryPageProps) {
    const theme = useTheme();
    const { t } = useTranslation('history');
    const { jobs, loading: jobsLoading, refresh, deleteJob } = useJobHistory();
    const [filter, setFilter] = useState<FilterStatus>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [reRunningId, setReRunningId] = useState<number | null>(null);
    const [detailsJob, setDetailsJob] = useState<JobWithRecipe | null>(null);
    const [rerunTarget, setRerunTarget] = useState<JobWithRecipe | null>(null);

    const { rerun, stop, busy, bulkDone } = useJobRerun({
        onStarted: id => { setReRunningId(id); refresh(); },
        onFinished: () => { setReRunningId(null); refresh(); },
    });
    useEffect(() => {
        if (bulkDone) { setReRunningId(null); refresh(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bulkDone]);

    const stats = useMemo(() => jobCounts(jobs), [jobs]);
    const filteredJobs = useMemo(() => filterJobs(jobs, filter, searchQuery), [jobs, filter, searchQuery]);

    if (jobsLoading) return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={40} thickness={4} />
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
                <Toolbar sx={{ px: 2, gap: 1 }}>
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="h6" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1, lineHeight: 1.2 }}>
                            <Clock size={18} color={theme.palette.secondary.main} />
                            {t('title')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {t('jobsFound', { count: stats.all })}
                        </Typography>
                    </Box>
                    <Tooltip title={t('refresh')}>
                        <IconButton onClick={() => refresh()} size="small">
                            <RefreshCcw size={18} />
                        </IconButton>
                    </Tooltip>
                </Toolbar>

                <Box sx={{ px: 2, pb: 2, pt: 0 }}>
                    <TextField
                        fullWidth
                        placeholder={t('searchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        variant="outlined"
                        size="small"
                        sx={{
                            mb: 2,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 3,
                                bgcolor: alpha(theme.palette.background.paper, 0.5)
                            }
                        }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search size={16} color={theme.palette.text.secondary} />
                                </InputAdornment>
                            ),
                            endAdornment: searchQuery && (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                                        <X size={14} />
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                    />

                    <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }} className="no-scrollbar">
                        <FilterChip label={t('filter.all')} count={stats.all} active={filter === 'all'} onClick={() => setFilter('all')} icon={<Database size={12} />} />
                        <FilterChip label={t('filter.running')} count={stats.running} active={filter === 'running'} onClick={() => setFilter('running')} icon={<Play size={12} />} color="secondary" />
                        <FilterChip label={t('filter.completed')} count={stats.completed} active={filter === 'completed'} onClick={() => setFilter('completed')} icon={<CheckCircle2 size={12} />} color="success" />
                        <FilterChip label={t('filter.stopped')} count={stats.stopped} active={filter === 'paused'} onClick={() => setFilter('paused')} icon={<PauseCircle size={12} />} />
                        <FilterChip label={t('filter.failed')} count={stats.failed} active={filter === 'failed'} onClick={() => setFilter('failed')} icon={<XCircle size={12} />} color="error" />
                    </Stack>
                </Box>
            </AppBar>

            <Box sx={{
                flex: 1,
                overflowY: 'auto',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                '&::-webkit-scrollbar': { width: 6 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                '&::-webkit-scrollbar-thumb': {
                    bgcolor: alpha(theme.palette.text.primary, 0.1),
                    borderRadius: 3
                },
                '&:hover::-webkit-scrollbar-thumb': {
                    bgcolor: alpha(theme.palette.text.primary, 0.2)
                }
            }}>
                {filteredJobs.length > 0 ? (
                    filteredJobs.map((job: JobWithRecipe) => (
                        <JobCard
                            key={job.id}
                            job={job}
                            isRunning={reRunningId === job.id || job.status === 'running'}
                            busy={busy}
                            onStop={() => stop(job)}
                            onRerun={() => setRerunTarget(job)}
                            onViewData={onViewData}
                            onDetails={() => setDetailsJob(job)}
                        />
                    ))
                ) : (
                    <Box sx={{ mt: 8 }}>
                        <EmptyState
                            title={t('noJobsFound')}
                            description={searchQuery ? t('noSearchResults') : t('noJobsYet')}
                            icon={<Search className="w-12 h-12 text-blue-500" />}
                        />
                    </Box>
                )}
            </Box>

            <RerunDialog
                job={rerunTarget}
                onClose={() => setRerunTarget(null)}
                onStart={(job, options) => { setRerunTarget(null); void rerun(job, options); }}
            />
            <JobDetailsDialog
                detailsJob={detailsJob}
                onClose={() => setDetailsJob(null)}
                onDelete={id => deleteJob(id)}
                onRerun={job => setRerunTarget(job)}
            />
        </Box>
    );
}

// Sub-components
function FilterChip({ label, count, active, onClick, icon, color = 'primary' }: any) {
    return (
        <Chip
            label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {label}
                    <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 800 }}>{count}</Typography>
                </Box>
            }
            icon={icon}
            clickable
            onClick={onClick}
            color={active ? color : 'default'}
            variant={active ? 'filled' : 'outlined'}
            size="small"
            sx={{
                height: 28,
                borderRadius: '8px',
                '& .MuiChip-label': { px: 1.5 },
                borderColor: !active ? 'divider' : undefined
            }}
        />
    );
}
