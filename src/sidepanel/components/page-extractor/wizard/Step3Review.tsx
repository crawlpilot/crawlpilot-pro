import { useState } from 'react';
import { Database, Loader2, Settings2, ExternalLink, RotateCcw, CheckCircle2, ChevronDown, ShieldAlert } from 'lucide-react';
import type { UrlStatus } from '../../../../shared/messages';
import { VERDICT_LABELS } from '../../../../shared/verdict/classifyPage';

interface Step3ReviewProps {
    elements: any[];
    selectedUrls: string[];
    isExtracting: boolean;
    isStopping: boolean;
    hasStopped: boolean;
    stoppedTableId: number | null;
    hasCompleted: boolean;
    completedTableId: number | null;
    completedPages: number;
    totalUniquePages: number;
    duplicatesRemoved: number;
    maxConcurrent: number;
    setMaxConcurrent: (val: number) => void;
    clickWaitMs: number;
    setClickWaitMs: (val: number) => void;
    requestDelay: number;
    setRequestDelay: (val: number) => void;
    loadTimeout: number;
    setLoadTimeout: (val: number) => void;
    waitForLoad: boolean;
    setWaitForLoad: (val: boolean) => void;
    enableRandomization: boolean;
    setEnableRandomization: (val: boolean) => void;
    waitForElements: boolean;
    setWaitForElements: (val: boolean) => void;
    elementTimeout: number;
    setElementTimeout: (val: number) => void;
    domainMinGapMs: number;
    setDomainMinGapMs: (val: number) => void;
    pauseOnChallenge: boolean;
    setPauseOnChallenge: (val: boolean) => void;
    listOutput: 'nested' | 'rows' | 'numbered';
    setListOutput: (val: 'nested' | 'rows' | 'numbered') => void;
    activeTabs: number;
    urlStatuses: UrlStatus[];
    previewTableId: number | null;
    handleStartExtraction: () => void;
    onStop: () => void;
    onBack: () => void;
    onViewPartialResults: (tableId: number) => void;
    onReset: () => void;
}

function shortUrl(url: string) {
    try {
        const u = new URL(url);
        const path = u.pathname.length > 1 ? u.pathname : '';
        return (u.hostname + path).slice(0, 44);
    } catch {
        return url.slice(0, 44);
    }
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${checked ? 'bg-primary' : 'bg-surface-darker'}`}
        >
            <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
        </button>
    );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <p className="text-xs text-text-primary">{label}</p>
                {hint && <p className="text-[10px] text-text-muted leading-tight">{hint}</p>}
            </div>
            <div className="flex-shrink-0">{children}</div>
        </div>
    );
}

const LIST_OUTPUT_LABELS = { nested: 'One column', rows: 'Row per item', numbered: 'Numbered' } as const;
const LIST_OUTPUT_HINTS = {
    nested: 'Each list is one JSON column holding all its items',
    rows: 'One row per item of the first list; the page’s other fields repeat on each row',
    numbered: 'Field 1 … Field 10 columns (the first 10 items)',
} as const;

function NumInput({ value, onChange, min, max, step = 500 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
    return (
        <div className="flex items-center gap-1">
            <button onClick={() => onChange(Math.max(min, value - step))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary hover:bg-border-subtle flex items-center justify-center text-xs leading-none">−</button>
            <span className="text-xs font-mono text-text-primary w-12 text-center tabular-nums">{value}</span>
            <button onClick={() => onChange(Math.min(max, value + step))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary hover:bg-border-subtle flex items-center justify-center text-xs leading-none">+</button>
        </div>
    );
}

export function Step3Review({
    elements,
    selectedUrls,
    isExtracting,
    isStopping,
    hasStopped,
    stoppedTableId,
    hasCompleted,
    completedTableId,
    completedPages,
    totalUniquePages,
    duplicatesRemoved,
    maxConcurrent,
    setMaxConcurrent,
    clickWaitMs,
    setClickWaitMs,
    requestDelay,
    setRequestDelay,
    loadTimeout,
    setLoadTimeout,
    waitForLoad,
    setWaitForLoad,
    enableRandomization,
    setEnableRandomization,
    waitForElements,
    setWaitForElements,
    elementTimeout,
    setElementTimeout,
    domainMinGapMs,
    setDomainMinGapMs,
    pauseOnChallenge,
    setPauseOnChallenge,
    listOutput,
    setListOutput,
    activeTabs,
    urlStatuses,
    previewTableId,
    handleStartExtraction,
    onStop,
    onBack,
    onViewPartialResults,
    onReset
}: Step3ReviewProps) {


    const [settingsOpen, setSettingsOpen] = useState(false);
    const isActive = isExtracting || isStopping;
    const extractingUrls = urlStatuses.filter(u => u.status === 'extracting');
    const errorUrls = urlStatuses.filter(u => u.status === 'error');
    const waitingUrls = urlStatuses.filter(u => u.status === 'waiting');
    const verdictCounts = errorUrls.reduce<Record<string, number>>((acc, u) => {
        const key = u.verdict && u.verdict !== 'ok' ? VERDICT_LABELS[u.verdict] : 'Failed';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
    }, {});
    const extractFieldCount = elements.filter(el => el.action !== 'click').length;
    const clickActionCount = elements.filter(el => el.action === 'click').length;

    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className="card text-center p-8 mt-4">
                <Database className="w-12 h-12 text-primary mx-auto mb-4 opacity-80" />
                <h2 className="text-lg font-bold mb-2">Review & Run</h2>
                <p className="text-text-muted mb-6 text-sm">
                    {extractFieldCount} field{extractFieldCount !== 1 ? 's' : ''} will be extracted from {selectedUrls.length} pages{clickActionCount > 0 ? `, with ${clickActionCount} click action${clickActionCount !== 1 ? 's' : ''}` : ''}.
                </p>

                {/* Summary */}
                <div className="max-w-xs mx-auto text-left mb-6 bg-surface-lighter rounded-lg p-4 text-sm border border-border-subtle shadow-sm">
                    <div className="flex justify-between mb-3 border-b border-border-subtle pb-2">
                        <span className="text-text-muted">Pages:</span>
                        <span className="font-bold text-primary">{selectedUrls.length}</span>
                    </div>
                    {duplicatesRemoved > 0 && (
                        <div className="flex justify-between pt-1 mb-2 border-b border-border-subtle pb-2">
                            <span className="text-text-muted">Unique pages:</span>
                            <span className="font-bold text-accent-warning">{selectedUrls.length - duplicatesRemoved} <span className="font-normal text-text-muted text-xs">({duplicatesRemoved} duplicate{duplicatesRemoved !== 1 ? 's' : ''} skipped)</span></span>
                        </div>
                    )}
                    <div className="flex justify-between pt-1">
                        <span className="text-text-muted">Fields per page:</span>
                        <span className="font-bold text-accent-ai">{extractFieldCount}</span>
                    </div>
                    {clickActionCount > 0 && (
                        <div className="flex justify-between pt-1 mt-1">
                            <span className="text-text-muted">Click actions:</span>
                            <span className="font-bold text-accent-warning">{clickActionCount}</span>
                        </div>
                    )}
                </div>

                {/* Pre-run settings — collapsible */}
                {!isActive && (
                    <div className="max-w-xs mx-auto mb-8">
                        <button
                            onClick={() => setSettingsOpen(o => !o)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border-subtle bg-surface-lighter/50 hover:bg-surface-lighter transition-colors group"
                        >
                            <div className="flex items-center gap-2">
                                <Settings2 className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-xs font-medium text-text-muted group-hover:text-text-primary transition-colors">Settings</span>
                            </div>
                            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${settingsOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {settingsOpen && (
                            <div className="mt-2 bg-surface-lighter rounded-lg border border-border-subtle shadow-sm overflow-hidden text-sm animate-fade-in-up">

                                {/* Performance */}
                                <div className="px-4 pt-4 pb-3 space-y-3">
                                    <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Performance</span>
                                    <SettingRow label="Concurrent Tabs" hint="Background tabs running in parallel (max 5)">
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setMaxConcurrent(Math.max(1, maxConcurrent - 1))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary flex items-center justify-center text-xs">−</button>
                                            <span className="text-xs font-mono text-text-primary w-4 text-center tabular-nums">{maxConcurrent}</span>
                                            <button onClick={() => setMaxConcurrent(Math.min(5, maxConcurrent + 1))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary flex items-center justify-center text-xs">+</button>
                                        </div>
                                    </SettingRow>
                                    <SettingRow label="Request Delay" hint="Pause between pages (ms)">
                                        <NumInput value={requestDelay} onChange={setRequestDelay} min={0} max={10000} step={500} />
                                    </SettingRow>
                                    <SettingRow label="Click Wait" hint="Wait after click actions (ms)">
                                        <NumInput value={clickWaitMs} onChange={setClickWaitMs} min={500} max={10000} step={500} />
                                    </SettingRow>
                                </div>

                                {/* Page Loading */}
                                <div className="border-t border-border-subtle px-4 py-3 space-y-3">
                                    <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Page Loading</span>
                                    <SettingRow label="Wait for Page Load" hint="Wait for full page load before extracting">
                                        <Toggle checked={waitForLoad} onChange={setWaitForLoad} />
                                    </SettingRow>
                                    {waitForLoad && (
                                        <SettingRow label="Load Timeout" hint="Max wait time (ms)">
                                            <NumInput value={loadTimeout} onChange={setLoadTimeout} min={1000} max={60000} step={1000} />
                                        </SettingRow>
                                    )}
                                </div>

                                {/* Anti-Bot */}
                                <div className="border-t border-border-subtle px-4 py-3 space-y-3">
                                    <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Anti-Bot Detection</span>
                                    <SettingRow label="Enable Randomization" hint="Add random delay jitter to avoid detection">
                                        <Toggle checked={enableRandomization} onChange={setEnableRandomization} />
                                    </SettingRow>
                                    <SettingRow label="Per-site Gap" hint="Minimum time between two pages of the same site, across all tabs (ms)">
                                        <NumInput value={domainMinGapMs} onChange={setDomainMinGapMs} min={0} max={60000} step={500} />
                                    </SettingRow>
                                    <SettingRow label="Pause on Bot Check" hint="Show the tab and wait for you to solve a CAPTCHA, then continue">
                                        <Toggle checked={pauseOnChallenge} onChange={setPauseOnChallenge} />
                                    </SettingRow>
                                </div>

                                {/* List output: same columns on every page, whatever the list lengths */}
                                {elements.some((e: any) => e.type === 'list' || e.type === 'smart') && (
                                    <div className="border-t border-border-subtle px-4 py-3 space-y-3">
                                        <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Lists</span>
                                        <SettingRow label="List Output" hint={LIST_OUTPUT_HINTS[listOutput]}>
                                            <div className="flex rounded-md overflow-hidden border border-border-subtle">
                                                {(['nested', 'rows', 'numbered'] as const).map(mode => (
                                                    <button
                                                        key={mode}
                                                        onClick={() => setListOutput(mode)}
                                                        className={`px-2 py-0.5 text-[10px] font-medium ${listOutput === mode ? 'bg-primary text-white' : 'bg-surface-darker text-text-muted hover:text-text-primary'}`}
                                                    >
                                                        {LIST_OUTPUT_LABELS[mode]}
                                                    </button>
                                                ))}
                                            </div>
                                        </SettingRow>
                                    </div>
                                )}

                                {/* Element Waiting */}
                                <div className="border-t border-border-subtle px-4 py-3 space-y-3">
                                    <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Element Waiting</span>
                                    <SettingRow label="Wait for Elements" hint="Wait for target elements to appear in DOM">
                                        <Toggle checked={waitForElements} onChange={setWaitForElements} />
                                    </SettingRow>
                                    {waitForElements && (
                                        <SettingRow label="Element Timeout" hint="Max wait time (ms, 0 = 5s default)">
                                            <NumInput value={elementTimeout} onChange={setElementTimeout} min={0} max={30000} step={1000} />
                                        </SettingRow>
                                    )}
                                </div>

                                <p className="text-[10px] text-text-muted px-4 pb-3 leading-tight">
                                    Extraction runs in a background window. You can continue browsing normally.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Live extraction panel */}
                {isActive && (
                    <div className="mb-6 rounded-lg border border-accent-ai/30 bg-accent-ai/5 text-left max-w-sm mx-auto overflow-hidden">

                        {/* Progress bar */}
                        <div className="px-5 pt-5 pb-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-text-primary flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-accent-ai animate-spin" />
                                    {isStopping ? 'Stopping…' : 'Processing Pages'}
                                </span>
                                <span className="text-xs font-bold text-accent-ai tabular-nums">
                                    {completedPages} / {totalUniquePages}
                                </span>
                            </div>
                            <div className="w-full bg-surface-darker h-2 rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="bg-gradient-to-r from-accent-ai to-primary h-full transition-all duration-500 rounded-full"
                                    style={{ width: `${Math.max(4, (completedPages / totalUniquePages) * 100)}%` }}
                                />
                            </div>
                            {activeTabs > 0 && !isStopping && (
                                <p className="text-[10px] text-text-muted mt-1.5">
                                    {activeTabs} background tab{activeTabs > 1 ? 's' : ''} active
                                </p>
                            )}
                        </div>

                        {/* Currently extracting URLs */}
                        {!isStopping && extractingUrls.length > 0 && (
                            <div className="border-t border-accent-ai/20 px-5 py-3 space-y-1.5">
                                {extractingUrls.map((u) => (
                                    <div key={u.url} className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent-ai animate-pulse flex-shrink-0" />
                                        <span className="text-[10px] text-text-muted font-mono truncate">{shortUrl(u.url)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Waiting for the user to solve a bot check */}
                        {waitingUrls.length > 0 && (
                            <div className="border-t border-accent-warning/30 bg-accent-warning/10 px-5 py-3 flex items-start gap-2">
                                <ShieldAlert className="w-4 h-4 text-accent-warning flex-shrink-0 mt-0.5" />
                                <p className="text-[11px] text-text-primary leading-snug">
                                    {waitingUrls.length === 1 ? 'A page is' : `${waitingUrls.length} pages are`} asking to verify you are human.
                                    Solve it in the tab that was brought to the front; extraction continues automatically.
                                </p>
                            </div>
                        )}

                        {/* Error URLs, grouped by why they failed */}
                        {errorUrls.length > 0 && (
                            <div className="border-t border-accent-error/20 px-5 py-2 space-y-1">
                                <div className="flex flex-wrap gap-1 pb-1">
                                    {Object.entries(verdictCounts).map(([label, n]) => (
                                        <span key={label} className="text-[10px] px-1.5 py-0.5 rounded bg-accent-error/10 text-accent-error font-medium">
                                            {label} · {n}
                                        </span>
                                    ))}
                                </div>
                                {errorUrls.slice(0, 3).map((u, i) => (
                                    <div key={i} className="flex items-center gap-1 text-[10px] text-accent-error" title={u.error}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent-error flex-shrink-0" />
                                        <span className="truncate font-mono">{shortUrl(u.url)}</span>
                                        {u.error && <span className="truncate text-text-muted">— {u.error}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Action button */}
                {isActive ? (
                    <div className="w-full max-w-sm mx-auto space-y-3">
                        <button
                            onClick={onStop}
                            disabled={isStopping}
                            className="btn btn-secondary text-accent-error border-accent-error/30 hover:bg-accent-error/10 w-full h-12 shadow-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Loader2 className="w-5 h-5 mr-2 animate-spin text-accent-error" />
                            {isStopping ? 'Stopping…' : 'Stop Extraction'}
                        </button>
                        {previewTableId != null && (
                            <button
                                onClick={() => onViewPartialResults(previewTableId)}
                                className="btn btn-ghost w-full h-10 text-sm border border-accent-ai/30 hover:bg-accent-ai/10 text-accent-ai"
                            >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Live Preview ({completedPages} page{completedPages !== 1 ? 's' : ''} so far)
                            </button>
                        )}
                    </div>
                ) : hasCompleted ? (
                    <div className="w-full max-w-sm mx-auto">
                        <div className="rounded-xl border border-accent-ai/30 bg-accent-ai/5 px-5 py-5 mb-4 text-center">
                            <CheckCircle2 className="w-8 h-8 text-accent-ai mx-auto mb-2" />
                            <p className="text-sm font-semibold text-text-primary">Extraction Complete</p>
                            <p className="text-xs text-text-muted mt-1">
                                {completedPages} page{completedPages !== 1 ? 's' : ''} extracted successfully
                            </p>
                        </div>
                        <div className="space-y-3">
                            {completedTableId != null && (
                                <button
                                    onClick={() => onViewPartialResults(completedTableId)}
                                    className="btn btn-primary w-full h-11 text-sm"
                                >
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Open Results Table
                                </button>
                            )}
                            <button onClick={onReset} className="btn btn-ghost w-full h-10 text-sm text-text-muted">
                                <RotateCcw className="w-4 h-4 mr-2" />
                                New Extraction
                            </button>
                        </div>
                    </div>
                ) : hasStopped ? (
                    <div className="w-full max-w-sm mx-auto">
                        <div className="rounded-xl border border-accent-ai/30 bg-accent-ai/5 px-5 py-5 mb-4 text-center">
                            <CheckCircle2 className="w-8 h-8 text-accent-ai mx-auto mb-2" />
                            <p className="text-sm font-semibold text-text-primary">Extraction Stopped</p>
                            <p className="text-xs text-text-muted mt-1">
                                {completedPages} page{completedPages !== 1 ? 's' : ''} extracted before stopping
                            </p>
                        </div>
                        <div className="space-y-3">
                            {stoppedTableId != null && (
                                <button
                                    onClick={() => onViewPartialResults(stoppedTableId)}
                                    className="btn btn-primary w-full h-11 text-sm"
                                >
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Open Results Table
                                </button>
                            )}
                            <button onClick={onReset} className="btn btn-ghost w-full h-10 text-sm text-text-muted">
                                <RotateCcw className="w-4 h-4 mr-2" />
                                New Extraction
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            onClick={handleStartExtraction}
                            disabled={selectedUrls.length === 0 || elements.length === 0}
                            className="btn btn-primary w-full max-w-sm mx-auto h-12 shadow-lg shadow-primary/20 text-base"
                        >
                            <Database className="w-5 h-5 mr-2" />
                            Run Bulk Extraction
                        </button>
                        <button
                            onClick={onBack}
                            className="btn btn-ghost text-sm mt-4 inline-flex justify-center w-full max-w-sm mx-auto"
                        >
                            Back to Schema
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
