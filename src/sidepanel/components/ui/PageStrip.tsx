import { Avatar, Box, Tooltip, Typography } from '@mui/material';
import { AlertCircle, Globe } from 'lucide-react';
import type { PageTab } from '../../hooks/usePageTab';

/** The page the tools are working on: its icon, title and host, or why there is none. */
export default function PageStrip({ page, message }: { page: PageTab; message?: string }) {
    if (!page.web) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, borderRadius: '12px', bgcolor: 'rgba(244,63,94,0.08)', border: 1, borderColor: 'rgba(244,63,94,0.3)' }}>
                <AlertCircle size={15} style={{ color: 'var(--cp-error)', flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: 'text.primary' }}>{message ?? 'Open a web page (http or https) to use CrawlPilot on it.'}</Typography>
            </Box>
        );
    }
    return (
        <Tooltip title={page.url} placement="bottom-start">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.6, borderRadius: '12px', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.03)', border: 1, borderColor: 'divider', minWidth: 0 }}>
                <Avatar src={page.favIconUrl} variant="rounded" sx={{ width: 16, height: 16, bgcolor: 'transparent' }}>
                    <Globe size={13} color="var(--cp-text-2)" />
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, display: 'block', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {page.title || page.host}
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block', lineHeight: 1.2 }}>{page.host}</Typography>
                </Box>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 6px rgba(16,185,129,0.8)', flexShrink: 0 }} />
            </Box>
        </Tooltip>
    );
}
