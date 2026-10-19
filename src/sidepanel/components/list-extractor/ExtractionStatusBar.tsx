import { Play, RefreshCw, X, Database, Layers } from 'lucide-react';
import { ExtractionStatus } from '../../../shared/types/extraction';
import { Box, Paper, Typography, Button, LinearProgress, Stack, styled } from '@mui/material';

const GlassPaper = styled(Paper)(() => ({
    padding: '20px',
    borderRadius: '24px',
    background: 'rgb(var(--cp-surface-rgb) / 0.85)',
    backdropFilter: 'blur(16px) saturate(180%)',
    border: '1px solid rgb(var(--cp-ink-rgb) / 0.08)',
    boxShadow: '0 25px 40px -10px rgba(0, 0, 0, 0.5), 0 0 20px rgb(var(--cp-accent-rgb) / 0.05)',
    position: 'relative',
    overflow: 'hidden',
    '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '1px',
        background: 'linear-gradient(90deg, transparent, rgb(var(--cp-accent-rgb) / 0.3), transparent)',
    }
}));

const StatBox = styled(Box)(() => ({
    flex: 1,
    padding: '12px 16px',
    borderRadius: '16px',
    background: 'rgb(var(--cp-ink-rgb) / 0.03)',
    border: '1px solid rgb(var(--cp-ink-rgb) / 0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
}));

interface ExtractionStatusBarProps {
    status: ExtractionStatus;
    hasSelectors: boolean;
    selectorCount: number;
    onStart: () => void;
    onStop: (force?: boolean) => void;
    showStartButton?: boolean;
}

export function ExtractionStatusBar({ status, hasSelectors, selectorCount, onStart, onStop, showStartButton = true }: ExtractionStatusBarProps) {
    return (
        <Box sx={{ position: 'absolute', bottom: 24, left: 16, right: 16, zIndex: 100 }}>
            {status.isExtracting ? (
                <Stack spacing={2}>
                    <GlassPaper elevation={0}>
                        <Stack spacing={2.5}>
                            {/* Header Info */}
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: '12px',
                                        bgcolor: 'rgb(var(--cp-accent-rgb) / 0.1)',
                                        color: 'var(--cp-accent)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 0 15px rgb(var(--cp-accent-rgb) / 0.2)'
                                    }}>
                                        <RefreshCw className="animate-spin" size={20} strokeWidth={2.5} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
                                            Extracting Data
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'rgb(var(--cp-ink-rgb) / 0.5)', fontWeight: 500 }}>
                                            Scanning page and collecting items...
                                        </Typography>
                                    </Box>
                                </Box>
                                <Button
                                    size="small"
                                    title="Shift+Click to Force Stop"
                                    onClick={(e) => onStop(e.shiftKey)}
                                    sx={{
                                        borderRadius: '10px',
                                        minWidth: 0,
                                        px: 2,
                                        py: 0.75,
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(239, 68, 68, 0.1)',
                                        color: '#ef4444',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        '&:hover': { bgcolor: '#ef4444', color: 'white' },
                                        transition: 'all 0.2s'
                                    }}
                                    startIcon={<X size={14} />}
                                >
                                    Stop
                                </Button>
                            </Box>

                            {/* Stats Grid */}
                            <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <StatBox>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <Database size={12} className="text-cyan-400" />
                                        <Typography variant="caption" sx={{ color: 'rgb(var(--cp-ink-rgb) / 0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                                            Items Found
                                        </Typography>
                                    </Box>
                                    <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 800, fontFamily: 'monospace' }}>
                                        {status.totalProcessed}
                                    </Typography>
                                </StatBox>

                                <StatBox>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                        <Layers size={12} className="text-cyan-400" />
                                        <Typography variant="caption" sx={{ color: 'rgb(var(--cp-ink-rgb) / 0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                                            Current Page
                                        </Typography>
                                    </Box>
                                    <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 800, fontFamily: 'monospace' }}>
                                        {status.currentPage || 1}
                                    </Typography>
                                </StatBox>
                            </Box>
                            {!!status.duplicates && (
                                <Typography variant="caption" sx={{ color: 'rgb(var(--cp-ink-rgb) / 0.5)', mt: -1 }}>
                                    {status.duplicates} duplicate row{status.duplicates !== 1 ? 's' : ''} from earlier pages skipped
                                </Typography>
                            )}

                            {/* Progress Bar */}
                            <Box sx={{ position: 'relative', pt: 0.5 }}>
                                <LinearProgress
                                    variant="indeterminate"
                                    sx={{
                                        borderRadius: 2,
                                        height: 6,
                                        bgcolor: 'rgb(var(--cp-ink-rgb) / 0.05)',
                                        '& .MuiLinearProgress-bar': {
                                            background: 'linear-gradient(90deg, #06b6d4, #3b82f6)',
                                            boxShadow: '0 0 10px rgb(var(--cp-accent-rgb) / 0.5)'
                                        }
                                    }}
                                />
                            </Box>
                        </Stack>
                    </GlassPaper>
                </Stack>
            ) : showStartButton ? (
                <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    onClick={onStart}
                    disabled={!hasSelectors}
                    startIcon={<Play size={18} fill="currentColor" />}
                    sx={{
                        borderRadius: '20px',
                        py: 2,
                        background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                        boxShadow: '0 10px 25px -5px rgb(var(--cp-accent-rgb) / 0.4)',
                        fontSize: '1rem',
                        textTransform: 'none',
                        fontWeight: 700,
                        border: '1px solid rgb(var(--cp-ink-rgb) / 0.1)',
                        '&:hover': {
                            background: 'linear-gradient(135deg, #0891b2 0%, #2563eb 100%)',
                            boxShadow: '0 15px 30px -5px rgb(var(--cp-accent-rgb) / 0.5)',
                            transform: 'translateY(-2px)'
                        },
                        '&:active': {
                            transform: 'translateY(0)'
                        },
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                >
                    Run Extraction · {selectorCount} {selectorCount === 1 ? 'field' : 'fields'}
                </Button>
            ) : null}
        </Box>
    );
}
