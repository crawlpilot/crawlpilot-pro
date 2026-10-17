import { useState } from 'react';
import { Box, IconButton, Paper, Tab, Tabs, Typography } from '@mui/material';
import { ChevronLeft } from 'lucide-react';
import ReconPanel from '../components/toolkit/ReconPanel';
import SelectorLabPanel from '../components/toolkit/SelectorLabPanel';

type ToolkitTab = 'recon' | 'lab';

const TAB_KEY = 'crawlpilot.toolkit.tab';

function initialTab(): ToolkitTab {
    try {
        const v = localStorage.getItem(TAB_KEY);
        if (v === 'recon' || v === 'lab') return v;
    } catch { /* storage blocked */ }
    return 'recon';
}

export default function ToolkitPage({ onBack }: { onBack: () => void }) {
    const [tab, setTab] = useState<ToolkitTab>(initialTab);

    const change = (_: unknown, v: ToolkitTab) => {
        setTab(v);
        try { localStorage.setItem(TAB_KEY, v); } catch { /* storage blocked */ }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <Paper elevation={0} sx={{ px: 2, pt: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <IconButton onClick={onBack} size="small"><ChevronLeft size={20} /></IconButton>
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>Scraper Toolkit</Typography>
                        <Typography variant="caption" color="text.secondary">Inspect pages and selectors before you scrape</Typography>
                    </Box>
                </Box>
                <Tabs value={tab} onChange={change} variant="fullWidth" sx={{ mt: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 600 } }}>
                    <Tab value="recon" label="Page Recon" />
                    <Tab value="lab" label="Selector Lab" />
                </Tabs>
            </Paper>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                {tab === 'recon' ? <ReconPanel /> : <SelectorLabPanel />}
            </Box>
        </Box>
    );
}
