/** Building blocks shared by the toolkit's tools, so the three read as one product. */
import { ReactNode, useState } from 'react';
import { Box, ButtonBase, Collapse, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { copyText } from '../../services/clipboard';

export const ACCENT = '#F59E0B';

export const TONE = {
    good: { fg: 'success.main', bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.35)' },
    warn: { fg: 'warning.main', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.35)' },
    bad: { fg: 'error.main', bg: 'rgba(244, 63, 94, 0.08)', border: 'rgba(244, 63, 94, 0.35)' },
    info: { fg: 'primary.main', bg: 'rgba(6, 182, 212, 0.08)', border: 'rgba(6, 182, 212, 0.35)' },
    neutral: { fg: 'text.secondary', bg: 'rgba(148, 163, 184, 0.06)', border: 'divider' },
} as const;
export type Tone = keyof typeof TONE;

export function CopyButton({ text, label, size = 14 }: { text: string; label?: string; size?: number }) {
    const [done, setDone] = useState(false);
    const copy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
    };
    return (
        <Tooltip title={done ? 'Copied' : label ?? 'Copy'}>
            <IconButton size="small" onClick={copy} aria-label={label ?? 'Copy'} sx={{ color: done ? 'success.main' : 'text.secondary' }}>
                {done ? <Check size={size} /> : <Copy size={size} />}
            </IconButton>
        </Tooltip>
    );
}

/** Monospace text with a copy button in its corner. */
export function CodeBlock({ code, maxHeight = 240 }: { code: string; maxHeight?: number }) {
    return (
        <Box sx={{ position: 'relative' }}>
            <Box component="pre" sx={{
                m: 0, p: 1.25, pr: 4.5, fontSize: 11, lineHeight: 1.5, maxHeight, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                bgcolor: 'rgba(0,0,0,0.35)', border: 1, borderColor: 'divider', borderRadius: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'text.primary',
            }}>{code}</Box>
            <Box sx={{ position: 'absolute', top: 4, right: 4 }}><CopyButton text={code} /></Box>
        </Box>
    );
}

/** A tool's first screen: what it is for, what you get, and the one thing to press. */
export function ToolIntro({ icon, title, text, points, children }: {
    icon: ReactNode; title: string; text: string; points?: string[]; children?: ReactNode;
}) {
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '16px', p: 2, background: 'linear-gradient(180deg, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0) 70%)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
                <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(245, 158, 11, 0.12)', color: ACCENT, display: 'flex' }}>{icon}</Box>
                <Typography variant="subtitle2" sx={{ fontSize: '0.85rem' }}>{title}</Typography>
            </Box>
            <Typography variant="body2" sx={{ mb: points ? 1 : 1.5 }}>{text}</Typography>
            {points && (
                <Stack spacing={0.5} sx={{ mb: 1.75 }}>
                    {points.map(p => (
                        <Box key={p} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                            <Check size={13} style={{ color: ACCENT, marginTop: 2, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>{p}</Typography>
                        </Box>
                    ))}
                </Stack>
            )}
            {children}
        </Box>
    );
}

/** A numbered step heading: "1  Record the page's calls". */
export function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: ReactNode }) {
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Box sx={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                    bgcolor: done ? 'success.main' : 'rgba(245, 158, 11, 0.15)', color: done ? '#04130d' : ACCENT,
                }}>{done ? <Check size={12} /> : n}</Box>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{title}</Typography>
            </Box>
            {hint && <Typography variant="caption" display="block" sx={{ ml: 3.5, mt: -0.5, mb: 0.75 }}>{hint}</Typography>}
            <Box sx={{ ml: 3.5 }}>{children}</Box>
        </Box>
    );
}

/** A collapsible group of details, its gist shown on the closed header. */
export function DetailSection({ icon, title, summary, defaultOpen = false, children }: {
    icon: ReactNode; title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', overflow: 'hidden', bgcolor: 'background.paper' }}>
            <ButtonBase onClick={() => setOpen(o => !o)} aria-expanded={open}
                sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1.1, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}>
                <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>{title}</Typography>
                {summary && <Typography variant="caption" sx={{ color: 'text.secondary', maxWidth: '55%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</Typography>}
                <ChevronDown size={15} style={{ color: '#64748B', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s', flexShrink: 0 }} />
            </ButtonBase>
            <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 1.5, pb: 1.5, pt: 0.25 }}>{children}</Box>
            </Collapse>
        </Box>
    );
}

/** A label/value line inside a section. */
export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.4, borderBottom: '1px dashed rgba(255,255,255,0.05)', '&:last-of-type': { borderBottom: 0 } }}>
            <Typography variant="caption" sx={{ flexShrink: 0 }}>{label}</Typography>
            <Typography variant="caption" sx={{ textAlign: 'right', wordBreak: 'break-all', color: 'text.primary', fontFamily: mono ? 'monospace' : undefined }}>{value}</Typography>
        </Box>
    );
}

/** One fact at a glance: a label, a short value and a colour for good / watch out / bad. */
export function FactTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: Tone }) {
    const t = TONE[tone];
    return (
        <Box sx={{ border: 1, borderColor: t.border, bgcolor: t.bg, borderRadius: '12px', p: 1.1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, color: t.fg, mb: 0.25 }}>
                {icon}
                <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.6rem' }}>{label}</Typography>
            </Box>
            <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>{value}</Typography>
        </Box>
    );
}

/** A small uppercase heading over a group. */
export function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.62rem' }}>{children}</Typography>
            {action}
        </Box>
    );
}
