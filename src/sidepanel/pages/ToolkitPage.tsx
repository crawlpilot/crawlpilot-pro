import { useCallback, useState } from 'react';
import { Avatar, Box, IconButton, Paper, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { ChevronLeft, Radar, Crosshair, Network, Globe, AlertCircle } from 'lucide-react';
import ReconPanel from '../components/toolkit/ReconPanel';
import SelectorLabPanel from '../components/toolkit/SelectorLabPanel';
import ApiFinderPanel from '../components/toolkit/ApiFinderPanel';
import { ToolkitProvider, ToolkitTool, usePageTab } from '../components/toolkit/context';
import { ACCENT } from '../components/toolkit/ui';

const TAB_KEY = 'crawlpilot.toolkit.tab';

const TOOLS: { id: ToolkitTool; label: string; icon: React.ReactElement; hint: string }[] = [
    { id: 'recon', label: 'Page Recon', icon: <Radar size={15} />, hint: 'How to scrape this page: HTTP, JSON or a browser' },
    { id: 'lab', label: 'Selector Lab', icon: <Crosshair size={15} />, hint: 'Find and test selectors that survive site changes' },
    { id: 'api', label: 'API Finder', icon: <Network size={15} />, hint: 'Find the JSON API behind the data you see' },
];

function initialTab(): ToolkitTool {
    const asked = new URLSearchParams(window.location.search).get('tool');
    if (asked === 'recon' || asked === 'lab' || asked === 'api') return asked;
    try {
        const v = localStorage.getItem(TAB_KEY);
        if (v === 'recon' || v === 'lab' || v === 'api') return v;
    } catch { /* storage blocked */ }
    return 'recon';
}

/** The page the tools are working on: its icon, title and host, or why there is none. */
function PageStrip({ page }: { page: ReturnType<typeof usePageTab> }) {
    if (!page.web) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, borderRadius: '12px', bgcolor: 'rgba(244,63,94,0.08)', border: 1, borderColor: 'rgba(244,63,94,0.3)' }}>
                <AlertCircle size={15} style={{ color: '#F43F5E', flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: 'text.primary' }}>Open a web page (http or https) to use the toolkit on it.</Typography>
            </Box>
        );
    }
    return (
        <Tooltip title={page.url} placement="bottom-start">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.6, borderRadius: '12px', bgcolor: 'rgba(255,255,255,0.03)', border: 1, borderColor: 'divider', minWidth: 0 }}>
                <Avatar src={page.favIconUrl} variant="rounded" sx={{ width: 16, height: 16, bgcolor: 'transparent' }}>
                    <Globe size={13} color="#94A3B8" />
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

export default function ToolkitPage({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (view: string) => void }) {
    const [tool, setTool] = useState<ToolkitTool>(initialTab);
    const page = usePageTab();

    const openTool = useCallback((v: ToolkitTool) => {
        setTool(v);
        try { localStorage.setItem(TAB_KEY, v); } catch { /* storage blocked */ }
    }, []);

    return (
        <ToolkitProvider page={page} openTool={openTool} navigate={onNavigate}>
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
                <Paper elevation={0} sx={{
                    px: 2, pt: 1.5, borderBottom: 1, borderColor: 'divider', zIndex: 10,
                    background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)', backdropFilter: 'blur(10px)',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
                        <IconButton onClick={onBack} size="small" aria-label="Back"
                            sx={{ color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.03)', '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: 'white' } }}>
                            <ChevronLeft size={20} />
                        </IconButton>
                        <Box sx={{ p: 0.9, borderRadius: '12px', bgcolor: 'rgba(245, 158, 11, 0.12)', color: ACCENT, display: 'flex' }}><Radar size={18} /></Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>Scraper Toolkit</Typography>
                            <Typography variant="caption" sx={{ display: 'block' }}>{TOOLS.find(t => t.id === tool)!.hint}</Typography>
                        </Box>
                    </Box>
                    <PageStrip page={page} />
                    <Tabs value={tool} onChange={(_, v: ToolkitTool) => openTool(v)} variant="fullWidth"
                        TabIndicatorProps={{ sx: { bgcolor: ACCENT, height: 2.5, borderRadius: '12px' } }}
                        sx={{
                            mt: 1, minHeight: 40,
                            '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 600, fontSize: '0.74rem', color: 'text.secondary', gap: 0.6, px: 0.5 },
                            '& .Mui-selected': { color: `${ACCENT} !important` },
                        }}>
                        {TOOLS.map(t => <Tab key={t.id} value={t.id} label={t.label} icon={t.icon} iconPosition="start" />)}
                    </Tabs>
                </Paper>
                <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                    {/* Kept mounted per page so switching tools doesn't throw away a report or a recording. */}
                    <Box key={`recon-${page.tab?.id}`} sx={{ display: tool === 'recon' ? 'block' : 'none' }}><ReconPanel /></Box>
                    {tool === 'lab' && <SelectorLabPanel />}
                    <Box key={`api-${page.tab?.id}`} sx={{ display: tool === 'api' ? 'block' : 'none' }}><ApiFinderPanel /></Box>
                </Box>
            </Box>
        </ToolkitProvider>
    );
}
