import { useCallback, useState } from 'react';
import PageStrip from '../components/ui/PageStrip';
import ToolHeader from '../components/ui/ToolHeader';
import { Radar, Crosshair, Network } from 'lucide-react';
import ReconPanel from '../components/toolkit/ReconPanel';
import SelectorLabPanel from '../components/toolkit/SelectorLabPanel';
import ApiFinderPanel from '../components/toolkit/ApiFinderPanel';
import { ToolkitProvider, ToolkitTool, usePageTab } from '../components/toolkit/context';
import { Segmented } from '../ui';

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
            <div className="flex h-full flex-col overflow-hidden bg-bg">
                <ToolHeader title="Scraper Toolkit" subtitle={TOOLS.find(t => t.id === tool)!.hint} onBack={onBack}>
                    <div className="mt-3 flex flex-col gap-2.5">
                        <PageStrip page={page} />
                        <Segmented tabs fullWidth size="sm" aria-label="Tools" value={tool} onChange={openTool}
                            options={TOOLS.map(t => ({ value: t.id, label: t.label, icon: t.icon }))} />
                    </div>
                </ToolHeader>
                <div className="flex-1 overflow-y-auto p-4">
                    {/* Kept mounted per page so switching tools doesn't throw away a report or a recording. */}
                    <div key={`recon-${page.tab?.id}`} className={tool === 'recon' ? 'block' : 'hidden'}><ReconPanel /></div>
                    {tool === 'lab' && <SelectorLabPanel />}
                    <div key={`api-${page.tab?.id}`} className={tool === 'api' ? 'block' : 'hidden'}><ApiFinderPanel /></div>
                </div>
            </div>
        </ToolkitProvider>
    );
}
