/**
 * The one header every tool uses: back, the tool's name, one line saying what it does, optional
 * actions on the right, and the steps of a guided flow with their names ("1 Pick · 2 Pages · 3 Get data").
 * Kept compact so the panel's height goes to the content (docs/plans/ux-simplification-plan.md §4.1).
 */
import { ReactNode } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Check, ChevronLeft } from 'lucide-react';

interface ToolHeaderProps {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    onBack?: () => void;
    /** Buttons on the right of the title row. */
    actions?: ReactNode;
    /** Names of the steps of a guided flow, and the current one (1-based). Hidden for a single step. */
    steps?: { labels: string[]; current: number };
    /** A thin moving bar along the top while something loads. */
    loading?: boolean;
    /** Anything under the title (tabs, a search row, the page strip). */
    children?: ReactNode;
}

function Steps({ labels, current }: { labels: string[]; current: number }) {
    return (
        <Box component="ol" aria-label="Steps" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, m: 0, mt: 1.25, p: 0, listStyle: 'none' }}>
            {labels.map((label, i) => {
                const n = i + 1;
                const done = n < current;
                const active = n === current;
                return (
                    <Box component="li" key={label} aria-current={active ? 'step' : undefined}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                        <Box sx={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10.5, fontWeight: 700,
                            bgcolor: active ? 'primary.main' : done ? 'rgb(var(--cp-accent-rgb) / 0.18)' : 'rgb(var(--cp-ink-rgb) / 0.06)',
                            color: active ? 'primary.contrastText' : done ? 'var(--cp-accent)' : 'text.secondary',
                        }}>
                            {done ? <Check size={11} strokeWidth={3} /> : n}
                        </Box>
                        <Typography variant="caption" noWrap sx={{
                            fontSize: '0.72rem', fontWeight: active ? 700 : 500,
                            color: active ? 'text.primary' : done ? 'text.secondary' : 'var(--cp-text-3)',
                        }}>{label}</Typography>
                        {n < labels.length && <Box sx={{ flex: 1, height: '1px', minWidth: 8, bgcolor: done ? 'rgb(var(--cp-accent-rgb) / 0.4)' : 'divider' }} />}
                    </Box>
                );
            })}
        </Box>
    );
}

export default function ToolHeader({ title, subtitle, icon, onBack, actions, steps, loading, children }: ToolHeaderProps) {
    return (
        <Box component="header" sx={{
            position: 'relative', px: 2, pt: 1.25, pb: 1.25, borderBottom: 1, borderColor: 'divider',
            bgcolor: 'background.paper', zIndex: 10, flexShrink: 0,
        }}>
            {loading && (
                <Box sx={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2, overflow: 'hidden',
                    '&::after': {
                        content: '""', position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
                        background: 'linear-gradient(90deg, transparent, #22D3EE, transparent)',
                        animation: 'toolHeaderLoading 1.4s ease-in-out infinite',
                    },
                    '@keyframes toolHeaderLoading': { '0%': { transform: 'translateX(-150%)' }, '100%': { transform: 'translateX(350%)' } },
                }} />
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {onBack && (
                    <Tooltip title="Back">
                        <IconButton onClick={onBack} size="small" aria-label="Back" sx={{ ml: -0.75, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                            <ChevronLeft size={20} />
                        </IconButton>
                    </Tooltip>
                )}
                {icon && <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box>}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography component="h1" variant="h6" noWrap sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.25 }}>{title}</Typography>
                    {subtitle && <Typography variant="caption" noWrap sx={{ display: 'block', fontSize: '0.72rem', color: 'text.secondary' }} title={subtitle}>{subtitle}</Typography>}
                </Box>
                {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{actions}</Box>}
            </Box>
            {steps && steps.labels.length > 1 && <Steps labels={steps.labels} current={steps.current} />}
            {children}
        </Box>
    );
}
