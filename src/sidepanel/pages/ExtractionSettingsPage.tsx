
import {
    ArrowLeft,
    Settings,
    Globe,
    Clock,
    Shield,
    ShieldCheck,
    Info,
    Minus,
    Plus,
    Eye
} from 'lucide-react';
import { useState, useEffect } from 'react';
import Badge from '../components/ui/Badge';

interface ExtractionSettings {
    concurrentTabs: number;
    requestDelay: number;
    pageTimeout: number;
    waitForPageLoad: boolean;
    loadTimeout: number;
    enableRandomization: boolean;
    waitForElements: boolean;
    elementTimeout: number;
    actionSpeed: number;
    showExtractionHighlights: boolean;
}

const DEFAULT_SETTINGS: ExtractionSettings = {
    concurrentTabs: 1,
    requestDelay: 1000,
    pageTimeout: 30000,
    waitForPageLoad: true,
    loadTimeout: 10000,
    enableRandomization: false,
    waitForElements: true,
    elementTimeout: 0,
    actionSpeed: 500,
    showExtractionHighlights: true
};

interface ExtractionSettingsPageProps {
    onBack: () => void;
}

export default function ExtractionSettingsPage({ onBack }: ExtractionSettingsPageProps) {
    const [settings, setSettings] = useState<ExtractionSettings>(DEFAULT_SETTINGS);

    useEffect(() => {
        chrome.storage.local.get(['extraction_settings'], (result) => {
            if (result.extraction_settings) {
                setSettings({ ...DEFAULT_SETTINGS, ...result.extraction_settings });
            }
        });
    }, []);

    const updateSetting = (key: keyof ExtractionSettings, value: any) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        chrome.storage.local.set({ extraction_settings: newSettings });
    };

    const Toggle = ({ active, onChange }: { active: boolean, onChange: (val: boolean) => void }) => (
        <button
            onClick={() => onChange(!active)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-200 focus:outline-none ${active ? 'bg-primary' : 'bg-surface-lighter'}`}
        >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${active ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
    );

    return (
        <div className="flex flex-col h-full bg-app text-text-primary overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border-subtle bg-app sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-1.5 hover:bg-surface-lighter rounded-lg text-text-muted transition-colors mr-1">
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                        <Settings className="w-4 h-4" />
                    </div>
                    <div>
                        <h1 className="font-bold text-sm leading-none tracking-wide text-text-primary uppercase">Configuration</h1>
                        <p className="text-xs text-text-muted mt-0.5 font-mono">Extraction settings</p>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Performance Section */}
                <div className="card space-y-4 bg-background-panel/50 border-border-subtle/50">
                    <div className="flex items-center gap-2 text-primary border-b border-border-subtle pb-3 -mx-3 px-3 mb-2">
                        <Globe className="w-3.5 h-3.5" />
                        <h2 className="text-[11px] font-bold uppercase tracking-widest">Performance</h2>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">Concurrent Tabs</span>
                                <Badge variant="ai" className="scale-75 origin-left bg-yellow-500/10 text-yellow-500 border-yellow-500/20">PRO</Badge>
                            </div>
                            <p className="text-[10px] text-text-muted mt-0.5 italic">Upgrade for parallel extraction</p>
                        </div>
                        <div className="flex items-center bg-background-app rounded border border-border-subtle p-0.5">
                            <button className="p-1 text-text-muted hover:text-white disabled:opacity-30" disabled>
                                <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 text-xs font-mono font-bold text-primary">{settings.concurrentTabs}</span>
                            <button className="p-1 text-text-muted hover:text-white disabled:opacity-30" disabled>
                                <Plus className="w-3 h-3" />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Request Delay</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Pause between requests (ms)</p>
                        </div>
                        <input
                            type="number"
                            className="bg-background-app border border-border-subtle rounded px-2 py-1 w-20 text-xs font-mono text-right focus:border-primary outline-none transition-colors"
                            value={settings.requestDelay}
                            onChange={(e) => updateSetting('requestDelay', parseInt(e.target.value) || 0)}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Page Timeout</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Max time per page (ms)</p>
                        </div>
                        <input
                            type="number"
                            className="bg-background-app border border-border-subtle rounded px-2 py-1 w-20 text-xs font-mono text-right focus:border-primary outline-none transition-colors"
                            value={settings.pageTimeout}
                            onChange={(e) => updateSetting('pageTimeout', parseInt(e.target.value) || 0)}
                        />
                    </div>
                </div>

                {/* Page Loading Section */}
                <div className="card space-y-4 bg-background-panel/50 border-border-subtle/50">
                    <div className="flex items-center gap-2 text-accent-success border-b border-border-subtle pb-3 -mx-3 px-3 mb-2">
                        <Clock className="w-3.5 h-3.5" />
                        <h2 className="text-[11px] font-bold uppercase tracking-widest">Page Loading</h2>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Wait for Page Load</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Ensures page is fully ready</p>
                        </div>
                        <Toggle
                            active={settings.waitForPageLoad}
                            onChange={(val) => updateSetting('waitForPageLoad', val)}
                        />
                    </div>

                    {settings.waitForPageLoad && (
                        <div className="flex items-center justify-between pl-3 border-l-2 border-accent-success/20 animate-fade-in py-1">
                            <div>
                                <span className="text-xs font-medium">Load Timeout</span>
                                <p className="text-[10px] text-text-muted mt-0.5">Max wait for "load" event</p>
                            </div>
                            <input
                                type="number"
                                className="bg-background-app border border-border-subtle rounded px-2 py-1 w-20 text-xs font-mono text-right focus:border-accent-success outline-none transition-colors"
                                value={settings.loadTimeout}
                                onChange={(e) => updateSetting('loadTimeout', parseInt(e.target.value) || 0)}
                            />
                        </div>
                    )}
                </div>

                {/* Anti-Bot Section */}
                <div className="card space-y-4 bg-background-panel/50 border-border-subtle/50">
                    <div className="flex items-center gap-2 text-orange-400 border-b border-border-subtle pb-3 -mx-3 px-3 mb-2">
                        <Shield className="w-3.5 h-3.5" />
                        <h2 className="text-[11px] font-bold uppercase tracking-widest">Bot Prevention</h2>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Enable Randomization</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Human-like behavior patterns</p>
                        </div>
                        <Toggle
                            active={settings.enableRandomization}
                            onChange={(val) => updateSetting('enableRandomization', val)}
                        />
                    </div>
                </div>

                {/* Visual Feedback Section */}
                <div className="card space-y-4 bg-background-panel/50 border-border-subtle/50">
                    <div className="flex items-center gap-2 text-cyan-400 border-b border-border-subtle pb-3 -mx-3 px-3 mb-2">
                        <Eye className="w-3.5 h-3.5" />
                        <h2 className="text-[11px] font-bold uppercase tracking-widest">Visual Feedback</h2>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Show Extraction Highlights</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Highlight elements during extraction</p>
                        </div>
                        <Toggle
                            active={settings.showExtractionHighlights}
                            onChange={(val) => updateSetting('showExtractionHighlights', val)}
                        />
                    </div>

                    {settings.showExtractionHighlights && (
                        <div className="pl-3 border-l-2 border-cyan-400/20 animate-fade-in py-1 space-y-3">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <span className="text-xs font-medium">Action Speed</span>
                                        <p className="text-[10px] text-text-muted mt-0.5">How long each element is highlighted</p>
                                    </div>
                                    <span className="text-xs font-mono font-bold text-cyan-400">{settings.actionSpeed}ms</span>
                                </div>
                                <input
                                    type="range"
                                    min="200"
                                    max="3000"
                                    step="100"
                                    value={settings.actionSpeed}
                                    onChange={(e) => updateSetting('actionSpeed', parseInt(e.target.value))}
                                    className="w-full accent-cyan-400"
                                />
                                <div className="flex justify-between text-[9px] text-text-muted mt-1">
                                    <span>⚡ Fast (200ms)</span>
                                    <span>🐢 Slow (3000ms)</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Element Waiting Section */}
                <div className="card space-y-4 bg-background-panel/50 border-border-subtle/50">
                    <div className="flex items-center gap-2 text-purple-400 border-b border-border-subtle pb-3 -mx-3 px-3 mb-2">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <h2 className="text-[11px] font-bold uppercase tracking-widest">Element Recovery</h2>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-xs font-medium">Wait for Elements</span>
                            <p className="text-[10px] text-text-muted mt-0.5">Stabilize selection before scraping</p>
                        </div>
                        <Toggle
                            active={settings.waitForElements}
                            onChange={(val) => updateSetting('waitForElements', val)}
                        />
                    </div>

                    {settings.waitForElements && (
                        <div className="flex items-center justify-between pl-3 border-l-2 border-purple-400/20 animate-fade-in py-1">
                            <div>
                                <span className="text-xs font-medium">Element Timeout</span>
                                <p className="text-[10px] text-text-muted mt-0.5">Wait time (0 = instant)</p>
                            </div>
                            <input
                                type="number"
                                className="bg-background-app border border-border-subtle rounded px-2 py-1 w-20 text-xs font-mono text-right focus:border-purple-400 outline-none transition-colors"
                                value={settings.elementTimeout}
                                onChange={(e) => updateSetting('elementTimeout', parseInt(e.target.value) || 0)}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Config Summary Strip */}
            <div className="p-4 bg-background-panel/80 border-t border-border-subtle sticky bottom-0 backdrop-blur-md">
                <div className="flex items-start gap-2.5 px-3 py-2 bg-primary/5 rounded border border-primary/20">
                    <Info className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px] leading-relaxed text-text-muted">
                        Active Profile: <span className="text-text-primary font-bold">{settings.concurrentTabs} tab</span>,
                        <span className="text-text-primary font-bold"> {settings.requestDelay}ms</span> delay.
                        Load: <span className="text-text-primary font-bold">{settings.waitForPageLoad ? settings.loadTimeout + 'ms' : 'off'}</span>.
                        Wait: <span className="text-text-primary font-bold">{settings.waitForElements ? (settings.elementTimeout || 'auto') : 'off'}</span>.
                        Speed: <span className="text-text-primary font-bold">{settings.showExtractionHighlights ? settings.actionSpeed + 'ms' : 'off'}</span>.
                    </p>
                </div>
            </div>
        </div>
    );
}
