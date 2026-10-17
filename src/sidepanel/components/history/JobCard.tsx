import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box, Button, Card, CardContent, Chip, IconButton, Stack, Theme, Typography, alpha, useTheme } from '@mui/material';
import { CheckCircle2, Clock, Database, ExternalLink, Loader2, PauseCircle, Play, RefreshCcw, Settings, XCircle } from 'lucide-react';
import type { Job } from '@/shared/types/database';
import type { JobWithRecipe } from './jobFilters';

function statusIcon(job: Job, theme: Theme) {
    if (job.stats?.stoppedByUser) return <PauseCircle size={16} color={theme.palette.text.secondary} />;
    switch (job.status) {
        case 'completed': return <CheckCircle2 size={16} color={theme.palette.success.main} />;
        case 'running': return <Play size={16} color={theme.palette.secondary.main} className="animate-pulse" />;
        case 'failed': return <XCircle size={16} color={theme.palette.error.main} />;
        case 'paused': return <PauseCircle size={16} color={theme.palette.text.secondary} />;
        case 'pending': return <Clock size={16} color={theme.palette.text.secondary} />;
        default: return <Clock size={16} color={theme.palette.text.secondary} />;
    }
}

function statusColor(job: Job): 'default' | 'secondary' | 'error' | 'success' {
    if (job.stats?.stoppedByUser) return 'default';
    switch (job.status) {
        case 'completed': return 'success';
        case 'running': return 'secondary';
        case 'failed': return 'error';
        case 'paused': return 'default';
        default: return 'default';
    }
}

function timeAgo(timestamp: number, tc: TFunction) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return tc('time.justNow');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return tc('time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tc('time.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days === 1) return tc('time.yesterday');
    return tc('time.daysAgo', { count: days });
}

interface Props {
    job: JobWithRecipe;
    isRunning: boolean;
    /** Another run is in progress: re-running is disabled. */
    busy: boolean;
    onStop: () => void;
    onRerun: () => void;
    onViewData: (tableId: number) => void;
    onDetails: () => void;
}

/** One run in the history list: status, age, and stop / re-run / data / details actions. */
export function JobCard({ job, isRunning, busy, onStop, onRerun, onViewData, onDetails }: Props) {
    const theme = useTheme();
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const title = job.name || job.recipe?.name || t('untitledJob');
    const url = job.sourceUrl || t('unknownUrl');
    const emoji = title.includes('LinkedIn') ? '💼' : title.includes('Walmart') ? '🛒' : title.includes('Amazon') ? '📦' : '🌐';

    return (
        <Card
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
                                    icon={statusIcon(job, theme)}
                                    label={job.stats?.stoppedByUser ? 'STOPPED' : job.status}
                                    size="small"
                                    color={statusColor(job)}
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
                                    {timeAgo(job.createdAt, tc)}
                                </Typography>
                            </Stack>

                            <Stack direction="row" spacing={1}>
                                {isRunning ? (
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="error"
                                        onClick={(e) => { e.stopPropagation(); onStop(); }}
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
                                        onClick={(e) => { e.stopPropagation(); onRerun(); }}
                                        disabled={busy}
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
                                    onClick={(e) => { e.stopPropagation(); if (job.result?.tableDataId) onViewData(job.result.tableDataId); }}
                                    disabled={!job.result?.tableDataId}
                                    startIcon={<Database size={14} />}
                                    sx={{ minWidth: 'auto', px: 1.5, py: 0.2 }}
                                >
                                    {t('data')}
                                </Button>

                                <IconButton
                                    size="small"
                                    onClick={onDetails}
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
}
