import { useCallback, useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import PageStrip from '../components/ui/PageStrip';
import ToolHeader from '../components/ui/ToolHeader';
import { Radar, Crosshair, Network } from 'lucide-react';
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
                <ToolHeader title="Scraper Toolkit" subtitle={TOOLS.find(t => t.id === tool)!.hint} onBack={onBack}>
                    <Box sx={{ mt: 1.25 }} />
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
                </ToolHeader>
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
