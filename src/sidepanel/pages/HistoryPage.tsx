import { useMemo, useState, useEffect } from 'react';
import { sendToTab } from '../../shared/messages';
import { useTranslation } from 'react-i18next';
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
    LinearProgress,
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
    alpha,
    Switch,
    FormControlLabel,
    FormHelperText
} from '@mui/material';
import { Job, AutomationRecipe } from '@/shared/types/database';
import { stopReasonLabel } from '@/shared/listing/runStats';
import { VERDICT_LABELS, PageVerdict } from '@/shared/verdict/classifyPage';
import contentScriptPath from '../../content/element-selector?script';

type JobWithRecipe = Job & { recipe?: AutomationRecipe };

interface HistoryPageProps {
    onBack: () => void;
    onViewData: (tableId: number) => void;
}

type FilterStatus = 'all' | 'running' | 'completed' | 'paused' | 'failed';

export default function HistoryPage({ onViewData }: HistoryPageProps) {
    const theme = useTheme();
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const { jobs, loading: jobsLoading, refresh, deleteJob } = useJobHistory();
    const { startExtraction, stopExtraction, status: extractionStatus } = useExtractionProcess(() => {
        setReRunningId(null);
        refresh();
    }, (jobId) => {
        setReRunningId(jobId);
        refresh();
    });
    const { startBulkExtraction, stopBulkExtraction, hasCompleted, hasStopped } = useBulkExtraction();

    useEffect(() => {
        if (hasCompleted || hasStopped) {
            setReRunningId(null);
            refresh();
        }
    }, [hasCompleted, hasStopped]);
    const [filter, setFilter] = useState<FilterStatus>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [reRunningId, setReRunningId] = useState<number | null>(null);
    const [detailsJob, setDetailsJob] = useState<any | null>(null);

    // Rerun Dialog State
    const [rerunDialogOpen, setRerunDialogOpen] = useState(false);

    const [rerunTarget, setRerunTarget] = useState<JobWithRecipe | null>(null);
    const [rerunName, setRerunName] = useState('');
    const [rerunMaxPages, setRerunMaxPages] = useState<number>(10);
    const [rerunParallel, setRerunParallel] = useState(false);
    const [rerunConcurrent, setRerunConcurrent] = useState(3);

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
        if (seconds < 60) return tc('time.justNow');
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return tc('time.minutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return tc('time.hoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        if (days === 1) return tc('time.yesterday');
        return tc('time.daysAgo', { count: days });
    };

    const openRerunDialog = (job: JobWithRecipe) => {
        setRerunTarget(job);
        const config = job.configSnapshot || job.recipe?.config;
        setRerunName(job.name ? `${job.name} (${t('rerun')})` : `${t('rerun')}: ${job.recipe?.name || tc('na')}`);
        setRerunMaxPages(config?.options?.pagination?.maxPages || 10);
        setRerunParallel(config?.options?.useParallel || false);
        setRerunConcurrent(config?.options?.maxConcurrent || 3);
        setRerunDialogOpen(true);
    };

    /** Wait for the active tab to finish loading & inject content script */
    const waitForTabReady = async (timeout = 15000): Promise<void> => {
        const start = Date.now();
        // Wait for tab to finish loading
        while (Date.now() - start < timeout) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.status === 'complete' && tab?.url && !tab.url.startsWith('chrome://')) {
                break;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        // Inject content script and verify connection
        await ensureContentScriptInjected();
    };

    /** Inject content script into active tab and verify it responds */
    const ensureContentScriptInjected = async (maxRetries = 5): Promise<void> => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab found');

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Try pinging first — if it responds, script is already there
                await sendToTab(tab.id, 'PING');
                return; // Connected!
            } catch {
                // Not injected yet — inject it
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: [contentScriptPath]
                    });
                } catch (injectErr) {
                    console.warn(`[Rerun] Injection attempt ${attempt + 1} failed:`, injectErr);
                }
                await new Promise(r => setTimeout(r, 600));
            }
        }
        // Final check
        try {
            const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (finalTab?.id) await sendToTab(finalTab.id, 'PING');
        } catch {
            throw new Error('Failed to establish connection with content script after navigation.');
        }
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
                await waitForTabReady();
            } else if (activeTab && targetUrl && activeTab.url !== targetUrl) {
                // @ts-ignore
                await chrome.tabs.update(activeTab.id!, { url: targetUrl });
                await waitForTabReady();
            } else {
                // Same URL — just ensure content script is injected
                await ensureContentScriptInjected();
            }

            // [NEW] RE-QUERY active tab after any navigation/creation
            // This ensures we have the up-to-date tab ID (especially if a new tab was opened)
            const [finalActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });

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
                    customName: rerunName,
                    maxConcurrent: rerunConcurrent,
                    onStart: (newId) => {
                        setReRunningId(newId);
                        refresh();
                    }
                }).catch(err => {
                    setReRunningId(null);
                    console.error("Bulk re-run failed:", err);
                    alert("Bulk re-run failed: " + err.message);
                });
            } else {
                if (!config?.options?.fullSelectors || !config?.options?.pagination) {
                    alert("This job doesn't have enough configuration to re-run.");
                    return;
                }

                // [NEW] Use the ACTUAL active tab ID to sanitize selectors
                const sanitizedSelectors = config.options.fullSelectors.map((s: any) => ({
                    ...s,
                    sourceTabId: finalActiveTab?.id
                }));

                await startExtraction(
                    sanitizedSelectors,
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
                    filteredJobs.map((job: JobWithRecipe) => {
                        const isRunning = reRunningId === job.id || job.status === 'running';
                        const title = job.name || job.recipe?.name || t('untitledJob');
                        const url = job.sourceUrl || t('unknownUrl');

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
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const isBulk = job.recipe?.type === 'bulk-extraction' || job.configSnapshot?.type === 'bulk-extraction' || job.configSnapshot?.options?.actions?.[0]?.type === 'EXTRACT_PAGES';
                                                                if (isBulk) {
                                                                    stopBulkExtraction();
                                                                } else {
                                                                    stopExtraction();
                                                                }
                                                            }}
                                                            startIcon={<XCircle size={14} />}
                                                            sx={{ minWidth: 'auto', px: 1.5, py: 0.2 }}
                                                        >
                                                            {tc('stop')}
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            color="inherit"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openRerunDialog(job);
                                                            }}
                                                            disabled={extractionStatus.isExtracting}
                                                            startIcon={isRunning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                                                            sx={{
                                                                minWidth: 'auto',
                                                                px: 1.5,
                                                                py: 0.2,
                                                                borderColor: 'divider',
                                                            }}
                                                        >
                                                            {t('rerun')}
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
                                                        {t('data')}
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
                            title={t('noJobsFound')}
                            description={searchQuery ? t('noSearchResults') : t('noJobsYet')}
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
                <DialogTitle sx={{ pb: 1 }}>{t('configureRerun')}</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} sx={{ mt: 1 }}>
                        <TextField
                            label={t('runName')}
                            fullWidth
                            size="small"
                            value={rerunName}
                            onChange={(e) => setRerunName(e.target.value)}
                            placeholder={t('runNamePlaceholder')}
                        />
                        {rerunTarget?.configSnapshot?.options?.pagination?.mode === 'pagination' && (
                            <Box>
                                <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                                    {t('maxPages')}
                                </Typography>
                                <TextField
                                    type="number"
                                    fullWidth
                                    size="small"
                                    value={rerunMaxPages}
                                    onChange={(e) => setRerunMaxPages(parseInt(e.target.value) || 1)}
                                    InputProps={{ inputProps: { min: 1 } }}
                                    helperText={t('maxPagesHelper')}
                                />
                            </Box>
                        )}

                        {(rerunTarget?.configSnapshot?.type === 'bulk-extraction' || rerunTarget?.recipe?.type === 'bulk-extraction') && (
                            <>
                                <Box>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={rerunParallel}
                                                onChange={(e) => setRerunParallel(e.target.checked)}
                                                color="secondary"
                                            />
                                        }
                                        label={<Typography variant="body2">{t('parallelMode')}</Typography>}
                                    />
                                    <FormHelperText>{t('parallelModeHelper')}</FormHelperText>
                                </Box>

                                {rerunParallel && (
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
                                            {t('concurrencyLimit')}
                                        </Typography>
                                        <TextField
                                            type="number"
                                            fullWidth
                                            size="small"
                                            value={rerunConcurrent}
                                            onChange={(e) => setRerunConcurrent(parseInt(e.target.value) || 1)}
                                            InputProps={{ inputProps: { min: 1, max: 10 } }}
                                            helperText={t('concurrencyHelper')}
                                        />
                                    </Box>
                                )}
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 2, pt: 0 }}>
                    <Button onClick={() => setRerunDialogOpen(false)} color="inherit">{tc('cancel')}</Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={handleConfirmRerun}
                        startIcon={<Play size={16} />}
                    >
                        {t('startNow')}
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
                            <Typography variant="h6" lineHeight={1.2}>{t('details')}</Typography>
                            <Typography variant="caption" color="text.secondary">{t('idLabel', { id: detailsJob?.id })}</Typography>
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
                                    <Activity size={14} /> {t('performance')}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                    <DetailItem label={t('statusLabel')} value={detailsJob.stats?.stoppedByUser ? tc('status.stopped').toUpperCase() : detailsJob.status} capitalize />
                                    <DetailItem label={t('itemsExtracted')} value={detailsJob.stats?.itemsExtracted || 0} />
                                    <DetailItem label={t('pagesVisited')} value={detailsJob.stats?.pagesVisited || 1} />
                                    <DetailItem label={t('duration')} value={detailsJob.stats?.endTime
                                        ? `${Math.round((detailsJob.stats.endTime - detailsJob.stats.startTime) / 1000)}s`
                                        : tc('na')}
                                    />
                                    {detailsJob.stats?.stopReason && (
                                        <DetailItem label={t('stopReason', 'Stopped because')} value={stopReasonLabel(detailsJob.stats.stopReason)} />
                                    )}
                                    {!!detailsJob.stats?.duplicatesRemoved && (
                                        <DetailItem label={t('duplicatesSkipped', 'Duplicates skipped')} value={detailsJob.stats.duplicatesRemoved} />
                                    )}
                                    {detailsJob.configSnapshot?.type === 'bulk-extraction' && (
                                        <>
                                            <DetailItem label={t('parallel')} value={detailsJob.configSnapshot.options?.useParallel ? tc('yes') : tc('no')} />
                                            <DetailItem label={t('concurrency')} value={detailsJob.configSnapshot.options?.maxConcurrent || 1} />
                                        </>
                                    )}
                                </Box>
                                {detailsJob.stats?.verdicts && Object.keys(detailsJob.stats.verdicts).length > 0 && (
                                    <Box sx={{ mt: 2 }}>
                                        <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                            {t('pageChecks', 'Page checks')}
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                            {Object.entries(detailsJob.stats.verdicts).map(([v, n]) => (
                                                <Chip key={v} size="small" label={`${VERDICT_LABELS[v as PageVerdict] ?? v} · ${n}`}
                                                    color={v === 'ok' ? 'success' : v === 'challenge' || v === 'rate_limited' ? 'warning' : 'error'}
                                                    variant="outlined" />
                                            ))}
                                        </Box>
                                    </Box>
                                )}
                                {detailsJob.stats?.coverage && detailsJob.stats.coverage.length > 0 && (
                                    <Box sx={{ mt: 2 }}>
                                        <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                            {t('fieldCoverage', 'Rows filled per field')}
                                        </Typography>
                                        <Box sx={{ maxHeight: 160, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 0.5 }}>
                                            {detailsJob.stats.coverage.map((c: { name: string; fill: number }) => (
                                                <Box key={c.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, fontSize: 12 }}>
                                                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Box>
                                                    <LinearProgress variant="determinate" value={c.fill * 100} color={c.fill < 0.5 ? 'warning' : 'success'} sx={{ width: 60, height: 4, borderRadius: 2 }} />
                                                    <Box component="span" sx={{ width: 36, textAlign: 'right', fontFamily: 'monospace' }}>{Math.round(c.fill * 100)}%</Box>
                                                </Box>
                                            ))}
                                        </Box>
                                    </Box>
                                )}
                                {detailsJob.stats?.pageStats && detailsJob.stats.pageStats.length > 0 && (
                                    <Box sx={{ mt: 2 }}>
                                        <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                            {t('perPage', 'Rows per page')}
                                        </Typography>
                                        <Box sx={{ maxHeight: 160, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                                            {detailsJob.stats.pageStats.map((p: { page: number; rows: number; duplicates: number; unmapped?: number }) => (
                                                <Box key={p.page} sx={{ display: 'flex', justifyContent: 'space-between', px: 1.5, py: 0.5, fontSize: 12, fontFamily: 'monospace' }}>
                                                    <span>{t('pageN', 'Page {{n}}', { n: p.page })}</span>
                                                    <span title={p.unmapped ? `${p.unmapped} rows had content no field reads: the layout may have changed` : undefined}>
                                                        {p.rows}{p.duplicates > 0 ? ` (+${p.duplicates} dup)` : ''}{p.unmapped ? ` · ${p.unmapped} unmapped` : ''}
                                                    </span>
                                                </Box>
                                            ))}
                                        </Box>
                                    </Box>
                                )}
                            </Box>

                            <Divider />

                            <Box>
                                <Typography variant="overline" color="secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                    <Settings size={14} /> {t('configuration')}
                                </Typography>

                                <Box sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 2, border: 1, borderColor: 'divider', mb: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>{t('sourceUrl')}</Typography>
                                    <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {detailsJob.sourceUrl || tc('na')}
                                        {detailsJob.sourceUrl && (
                                            <IconButton size="small" onClick={() => window.open(detailsJob.sourceUrl, '_blank')}>
                                                <ExternalLink size={12} />
                                            </IconButton>
                                        )}
                                    </Typography>
                                </Box>

                                <Stack spacing={1}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="caption" color="text.secondary">{t('recipeType')}</Typography>
                                        <Typography variant="caption" fontFamily="monospace">{detailsJob.recipe?.type || detailsJob.configSnapshot?.type || tc('na')}</Typography>
                                    </Box>
                                    {(detailsJob.recipe?.type !== 'bulk-extraction' && detailsJob.configSnapshot?.type !== 'bulk-extraction') && (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="caption" color="text.secondary">{t('paginationMode')}</Typography>
                                            <Typography variant="caption" fontFamily="monospace">{detailsJob.configSnapshot?.options?.pagination?.mode || 'none'}</Typography>
                                        </Box>
                                    )}
                                </Stack>
                            </Box>
                        </>
                    )}
                </DialogContent>

                <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            startIcon={<Copy size={16} />}
                            color="inherit"
                            onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(detailsJob, null, 2));
                                alert(t('copiedToClipboard'));
                            }}
                        >
                            {tc('export')}
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
                            {tc('delete')}
                        </Button>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button onClick={() => setDetailsJob(null)} color="inherit">{tc('close')}</Button>
                        <Button
                            variant="contained"
                            color="secondary"
                            onClick={() => {
                                const job = detailsJob;
                                setDetailsJob(null);
                                openRerunDialog(job);
                            }}
                        >
                            {t('rerun')}
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
