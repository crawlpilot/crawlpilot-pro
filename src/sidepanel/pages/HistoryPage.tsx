import { useMemo, useState, useEffect } from 'react';
import { useJobHistory } from '../hooks/useDatabase';
import { useExtractionProcess } from '../hooks/useExtractionProcess';
import { useBulkExtraction } from '../hooks/useBulkExtraction';
import {
    RefreshCcw,
    Search,
    ExternalLink,
    Database,
    Play,
    Clock,
    CheckCircle2,
    XCircle,
    PauseCircle,
    Trash2,
    Settings,
    X,
    Loader2,
    Activity,
    Copy
} from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import {
    Box,
    Typography,
    IconButton,
    InputAdornment,
    TextField,
    Chip,
    Card,
    CardContent,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Stack,
    Tooltip,
    Divider,
    AppBar,
    Toolbar,
    useTheme,
    CircularProgress,
    alpha
} from '@mui/material';
import { Job, AutomationRecipe } from '@/shared/types/database';

type JobWithRecipe = Job & { recipe?: AutomationRecipe };

interface HistoryPageProps {
    onBack: () => void;
    onViewData: (tableId: number) => void;
}

type FilterStatus = 'all' | 'running' | 'completed' | 'paused' | 'failed';

export default function HistoryPage({ onViewData }: HistoryPageProps) {
    const theme = useTheme();
    const { jobs, loading: jobsLoading, refresh, deleteJob } = useJobHistory();
    const { startExtraction, stopExtraction, status: extractionStatus } = useExtractionProcess(() => {
        refresh();
    }, () => {
        refresh();
    });
    const { startBulkExtraction } = useBulkExtraction();
    const [filter, setFilter] = useState<FilterStatus>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [reRunningId, setReRunningId] = useState<number | null>(null);
    const [detailsJob, setDetailsJob] = useState<any | null>(null);

    // Rerun Dialog State
    const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
    const [userPlan, setUserPlan] = useState<string>('free');

    useEffect(() => {
        chrome.storage.local.get(['user_plan'], (result) => {
            if (typeof result.user_plan === 'string') {
                setUserPlan(result.user_plan);
            }
        });
    }, []);

    const isPaid = userPlan === 'paid';

    const handleUpgradeClick = () => {
        if (confirm('This is a PRO feature. Upgrade to unlock reruns, export and more. Would you like to visit the website to upgrade?')) {
            window.open('https://crawlpilot.tech/profile', '_blank');
        }
    };
    const [rerunTarget, setRerunTarget] = useState<JobWithRecipe | null>(null);
    const [rerunName, setRerunName] = useState('');
    const [rerunMaxPages, setRerunMaxPages] = useState<number>(10);

    const stats = useMemo(() => {
        return {
            all: jobs.length,
            running: jobs.filter(j => j.status === 'running').length,
            completed: jobs.filter(j => j.status === 'completed' && !j.stats?.stoppedByUser).length,
            stopped: jobs.filter(j => j.status === 'paused' || j.status === 'pending' || j.stats?.stoppedByUser).length,
            failed: jobs.filter(j => j.status === 'failed').length
        };
    }, [jobs]);

    const filteredJobs = useMemo(() => {
        return jobs
            .filter(j => {
                if (filter !== 'all') {
                    if (filter === 'paused') {
                        return j.status === 'paused' || j.status === 'pending' || !!j.stats?.stoppedByUser;
                    }
                    if (filter === 'completed') {
                        return j.status === 'completed' && !j.stats?.stoppedByUser;
                    }
                    return j.status === filter;
                }
                return true;
            })
            .filter(j => {
                if (!searchQuery) return true;
                const query = searchQuery.toLowerCase();
                const title = (j.recipe?.name || 'Untitled').toLowerCase();
                const url = (j.sourceUrl || '').toLowerCase();
                const type = (j.recipe?.type || '').toLowerCase();
                return (
                    title.includes(query) ||
                    url.includes(query) ||
                    type.includes(query)
                );
            });
    }, [jobs, filter, searchQuery]);

    const getStatusIcon = (job: Job) => {
        if (job.stats?.stoppedByUser) return <PauseCircle size={16} color={theme.palette.text.secondary} />;
        switch (job.status) {
            case 'completed': return <CheckCircle2 size={16} color={theme.palette.success.main} />;
            case 'running': return <Play size={16} color={theme.palette.secondary.main} className="animate-pulse" />;
            case 'failed': return <XCircle size={16} color={theme.palette.error.main} />;
            case 'paused': return <PauseCircle size={16} color={theme.palette.text.secondary} />;
            case 'pending': return <Clock size={16} color={theme.palette.text.secondary} />;
            default: return <Clock size={16} color={theme.palette.text.secondary} />;
        }
    };

    const getStatusColor = (job: Job): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
        if (job.stats?.stoppedByUser) return 'default';
        switch (job.status) {
            case 'completed': return 'success';
            case 'running': return 'secondary';
            case 'failed': return 'error';
            case 'paused': return 'default';
            default: return 'default';
        }
    };

    const getTimeAgo = (timestamp: number) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days === 1) return 'Yesterday';
        return `${days}d ago`;
    };

    const openRerunDialog = (job: JobWithRecipe) => {
        setRerunTarget(job);
        setRerunName(`Rerun: ${job.recipe?.name || 'Untitled'}`);
        setRerunMaxPages(job.configSnapshot?.options?.pagination?.maxPages || 10);
        setRerunDialogOpen(true);
    };

    const handleConfirmRerun = async () => {
        if (!rerunTarget) return;
        const job = rerunTarget;
        const config = job.configSnapshot || job.recipe?.config;
        if (!config) {
            alert("This job doesn't have enough configuration to re-run.");
            return;
        }

        setRerunDialogOpen(false);

        try {
            if (job.id) setReRunningId(job.id);
            const isFullPageExtension = window.location.protocol === 'chrome-extension:';
            // @ts-ignore
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const targetUrl = job.sourceUrl || (config.type === 'bulk-extraction' ? config.urls?.[0] : config.options?.url);

            if (isFullPageExtension && targetUrl) {
                // @ts-ignore
                await chrome.tabs.create({ url: targetUrl, active: true });
                await new Promise(r => setTimeout(r, 4000));
            } else if (activeTab && targetUrl && activeTab.url !== targetUrl) {
                // @ts-ignore
                await chrome.tabs.update(activeTab.id!, { url: targetUrl });
                await new Promise(r => setTimeout(r, 3000));
            }

            if (config.type === 'bulk-extraction') {
                const actions = config.options?.actions;
                const elements = actions?.[0]?.elements;
                const urls = config.urls;

                if (!elements || !urls || urls.length === 0) {
                    alert("This bulk extraction job doesn't have enough configuration to re-run.");
                    return;
                }

                await startBulkExtraction(urls, elements, {
                    recipeId: job.recipeId,
                    onComplete: () => {
                        refresh();
                    }
                });
            } else {
                if (!config?.options?.fullSelectors || !config?.options?.pagination) {
                    alert("This job doesn't have enough configuration to re-run.");
                    return;
                }

                await startExtraction(
                    config.options.fullSelectors,
                    config.options.pagination,
                    {
                        tableDataId: undefined, // Create NEW dataset
                        recipeId: job.recipeId, // REUSE existing recipe
                        customName: rerunName,
                        maxPages: rerunMaxPages
                    }
                );
            }

            console.log("Re-run started successfully");
        } catch (err) {
            console.error("Re-run failed:", err);
            alert("Re-run failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setReRunningId(null);
            refresh();
        }
    };

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
                            Job History
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {stats.all} jobs found
                        </Typography>
                    </Box>
                    <Tooltip title="Refresh">
                        <IconButton onClick={() => refresh()} size="small">
                            <RefreshCcw size={18} />
                        </IconButton>
                    </Tooltip>
                </Toolbar>

                <Box sx={{ px: 2, pb: 2, pt: 0 }}>
                    <TextField
                        fullWidth
                        placeholder="Search by title, URL or type..."
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
                        <FilterChip label="All" count={stats.all} active={filter === 'all'} onClick={() => setFilter('all')} icon={<Database size={12} />} />
                        <FilterChip label="Running" count={stats.running} active={filter === 'running'} onClick={() => setFilter('running')} icon={<Play size={12} />} color="secondary" />
                        <FilterChip label="Completed" count={stats.completed} active={filter === 'completed'} onClick={() => setFilter('completed')} icon={<CheckCircle2 size={12} />} color="success" />
                        <FilterChip label="Stopped" count={stats.stopped} active={filter === 'paused'} onClick={() => setFilter('paused')} icon={<PauseCircle size={12} />} />
                        <FilterChip label="Failed" count={stats.failed} active={filter === 'failed'} onClick={() => setFilter('failed')} icon={<XCircle size={12} />} color="error" />
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
                    filteredJobs.map((job: JobWithRecipe) => {
                        const isRunning = reRunningId === job.id;
                        const title = job.name || job.recipe?.name || 'Untitled Job';
                        const url = job.sourceUrl || 'Unknown URL';

                        let emoji = '🌐';
                        if (title.includes('Amazon')) emoji = '📦';
                        if (title.includes('Walmart')) emoji = '🛒';
                        if (title.includes('LinkedIn')) emoji = '💼';

                        return (
                            <Card
                                key={job.id}
                                variant="outlined"
                                sx={{
                                    borderRadius: 3,
                                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                    bgcolor: 'background.paper',
                                    transition: 'all 0.2s',
                                    flexShrink: 0,
                                    '&:hover': {
                                        borderColor: alpha(theme.palette.secondary.main, 0.3),
                                        boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.2)}`
                                    }
                                }}
                            >
                                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                    <Box sx={{ display: 'flex', gap: 2 }}>
                                        <Box
                                            sx={{
                                                width: 40, height: 40,
                                                borderRadius: 2,
                                                bgcolor: alpha(theme.palette.action.hover, 0.1),
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '1.25rem',
                                                border: 1,
                                                borderColor: 'divider'
                                            }}
                                        >
                                            {emoji}
                                        </Box>

                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                                                <Typography variant="body2" fontWeight={600} noWrap sx={{ color: 'text.primary', mr: 1 }}>
                                                    {title}
                                                </Typography>
                                            </Box>

                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5, color: 'text.secondary' }}>
                                                <ExternalLink size={10} />
                                                <Typography variant="caption" noWrap sx={{ opacity: 0.7, maxWidth: 200 }}>
                                                    {url}
                                                </Typography>
                                            </Box>

                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <Stack direction="row" spacing={1} alignItems="center">
                                                    <Chip
                                                        icon={getStatusIcon(job)}
                                                        label={job.stats?.stoppedByUser ? 'STOPPED' : job.status}
                                                        size="small"
                                                        color={getStatusColor(job)}
                                                        variant="outlined"
                                                        sx={{
                                                            height: 20,
                                                            fontSize: '0.65rem',
                                                            textTransform: 'uppercase',
                                                            fontWeight: 700,
                                                            '& .MuiChip-icon': { fontSize: 12 }
                                                        }}
                                                    />
                                                    <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.disabled' }}>
                                                        <Clock size={11} />
                                                        {getTimeAgo(job.createdAt)}
                                                    </Typography>
                                                </Stack>

                                                <Stack direction="row" spacing={1}>
                                                    {isRunning ? (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="error"
                                                            onClick={(e) => { e.stopPropagation(); stopExtraction(); }}
                                                            startIcon={<XCircle size={14} />}
                                                            sx={{ minWidth: 'auto', px: 1.5, py: 0.2 }}
                                                        >
                                                            Stop
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="inherit"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!isPaid) {
                                                                    handleUpgradeClick();
                                                                } else {
                                                                    openRerunDialog(job);
                                                                }
                                                            }}
                                                            disabled={extractionStatus.isExtracting}
                                                            startIcon={isRunning ? <Loader2 size={14} className="animate-spin" /> : (!isPaid ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> : <RefreshCcw size={14} />)}
                                                            sx={{
                                                                minWidth: 'auto',
                                                                px: 1.5,
                                                                py: 0.2,
                                                                borderColor: 'divider',
                                                                opacity: !isPaid ? 0.7 : 1,
                                                                bgcolor: !isPaid ? alpha(theme.palette.action.disabledBackground, 0.05) : 'transparent'
                                                            }}
                                                        >
                                                            Rerun
                                                        </Button>
                                                    )}

                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        color="primary"
                                                        onClick={(e) => { e.stopPropagation(); job.result?.tableDataId && onViewData(job.result.tableDataId); }}
                                                        disabled={!job.result?.tableDataId}
                                                        startIcon={<Database size={14} />}
                                                        sx={{ minWidth: 'auto', px: 1.5, py: 0.2 }}
                                                    >
                                                        Data
                                                    </Button>

                                                    <IconButton
                                                        size="small"
                                                        onClick={() => setDetailsJob(job)}
                                                        sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                                                    >
                                                        <Settings size={14} />
                                                    </IconButton>
                                                </Stack>
                                            </Box>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        );
                    })
                ) : (
                    <Box sx={{ mt: 8 }}>
                        <EmptyState
                            title="No jobs found"
                            description={searchQuery ? "No results match your search query." : "You haven't run any jobs yet."}
                            icon={<Search className="w-12 h-12 text-blue-500" />}
                        />
                    </Box>
                )}
            </Box>

            {/* Rerun Dialog */}
            <Dialog
                open={rerunDialogOpen}
                onClose={() => setRerunDialogOpen(false)}
                fullWidth
                maxWidth="xs"
                PaperProps={{
                    sx: { borderRadius: 3, bgcolor: 'background.paper', backgroundImage: 'none' }
                }}
            >
                <DialogTitle sx={{ pb: 1 }}>Configure Rerun</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        <TextField
                            label="Run Name"
                            fullWidth
                            size="small"
                            value={rerunName}
                            onChange={(e) => setRerunName(e.target.value)}
                            placeholder="Enter a name for this run"
                        />
                        {rerunTarget?.configSnapshot?.options?.pagination?.mode === 'pagination' && (
                            <Box>
                                <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                                    MAX PAGES TO EXTRACT
                                </Typography>
                                <TextField
                                    type="number"
                                    fullWidth
                                    size="small"
                                    value={rerunMaxPages}
                                    onChange={(e) => setRerunMaxPages(parseInt(e.target.value) || 1)}
                                    InputProps={{ inputProps: { min: 1 } }}
                                    helperText="Limits pagination to avoid long runs"
                                />
                            </Box>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 2, pt: 0 }}>
                    <Button onClick={() => setRerunDialogOpen(false)} color="inherit">Cancel</Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleConfirmRerun}
                        startIcon={<Play size={16} />}
                    >
                        Start Now
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Details Dialog */}
            <Dialog
                open={!!detailsJob}
                onClose={() => setDetailsJob(null)}
                fullWidth
                maxWidth="sm"
                PaperProps={{
                    sx: { borderRadius: 3, bgcolor: 'background.paper', backgroundImage: 'none' }
                }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ p: 1, bgcolor: alpha(theme.palette.secondary.main, 0.1), borderRadius: 1.5, color: 'secondary.main' }}>
                            <Settings size={20} />
                        </Box>
                        <Box>
                            <Typography variant="h6" lineHeight={1.2}>Details</Typography>
                            <Typography variant="caption" color="text.secondary">ID: {detailsJob?.id}</Typography>
                        </Box>
                    </Box>
                    <IconButton onClick={() => setDetailsJob(null)} size="small">
                        <X size={20} />
                    </IconButton>
                </DialogTitle>

                <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {detailsJob && (
                        <>
                            <Box>
                                <Typography variant="overline" color="secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <Activity size={14} /> Performance
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                    <DetailItem label="Status" value={detailsJob.stats?.stoppedByUser ? 'STOPPED' : detailsJob.status} capitalize />
                                    <DetailItem label="Items Extracted" value={detailsJob.stats?.itemsExtracted || 0} />
                                    <DetailItem label="Pages Visited" value={detailsJob.stats?.pagesVisited || 1} />
                                    <DetailItem label="Duration" value={detailsJob.stats?.endTime
                                        ? `${Math.round((detailsJob.stats.endTime - detailsJob.stats.startTime) / 1000)}s`
                                        : 'N/A'}
                                    />
                                </Box>
                            </Box>

                            <Divider />

                            <Box>
                                <Typography variant="overline" color="secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <Settings size={14} /> Configuration
                                </Typography>

                                <Box sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 2, border: 1, borderColor: 'divider', mb: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>Source URL</Typography>
                                    <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {detailsJob.sourceUrl || 'N/A'}
                                        {detailsJob.sourceUrl && (
                                            <IconButton size="small" onClick={() => window.open(detailsJob.sourceUrl, '_blank')}>
                                                <ExternalLink size={12} />
                                            </IconButton>
                                        )}
                                    </Typography>
                                </Box>

                                <Stack spacing={1}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="caption" color="text.secondary">Recipe Type</Typography>
                                        <Typography variant="caption" fontFamily="monospace">{detailsJob.recipe?.type || 'N/A'}</Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="caption" color="text.secondary">Pagination Mode</Typography>
                                        <Typography variant="caption" fontFamily="monospace">{detailsJob.configSnapshot?.options?.pagination?.mode || 'none'}</Typography>
                                    </Box>
                                </Stack>
                            </Box>
                        </>
                    )}
                </DialogContent>

                <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            startIcon={!isPaid ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> : <Copy size={16} />}
                            color="inherit"
                            onClick={() => {
                                if (!isPaid) {
                                    handleUpgradeClick();
                                    return;
                                }
                                navigator.clipboard.writeText(JSON.stringify(detailsJob, null, 2));
                                alert("Copied to clipboard");
                            }}
                            sx={{ opacity: !isPaid ? 0.7 : 1 }}
                        >
                            Export
                        </Button>
                        <Button
                            startIcon={<Trash2 size={16} />}
                            color="error"
                            onClick={() => {
                                if (detailsJob?.id) {
                                    deleteJob(detailsJob.id);
                                    setDetailsJob(null);
                                }
                            }}
                        >
                            Delete
                        </Button>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button onClick={() => setDetailsJob(null)} color="inherit">Close</Button>
                        <Button
                            variant="contained"
                            color="secondary"
                            onClick={() => {
                                if (!isPaid) {
                                    handleUpgradeClick();
                                    return;
                                }
                                const job = detailsJob;
                                setDetailsJob(null);
                                openRerunDialog(job);
                            }}
                            sx={{
                                opacity: !isPaid ? 0.8 : 1,
                                bgcolor: !isPaid ? 'grey.700' : 'secondary.main',
                                '&:hover': {
                                    bgcolor: !isPaid ? 'grey.600' : 'secondary.dark',
                                }
                            }}
                        >
                            {!isPaid ? 'Upgrade' : 'Rerun'}
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>
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

function DetailItem({ label, value, capitalize }: any) {
    return (
        <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: alpha('#fff', 0.02) }}>
            <Typography variant="caption" fontWeight={700} color="text.disabled" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {label}
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5, textTransform: capitalize ? 'capitalize' : 'none' }}>
                {value}
            </Typography>
        </Box>
    );
}
