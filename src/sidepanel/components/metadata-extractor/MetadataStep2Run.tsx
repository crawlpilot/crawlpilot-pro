import { useTranslation } from 'react-i18next';
import { Database, Loader2, CheckCircle2, ExternalLink, RotateCcw, Link, FileText } from 'lucide-react';
import type { MetadataExtractOptions } from '../../../shared/types/metadata';

import type { UrlStatus } from '../../../shared/messages';

interface MetadataStep2RunProps {
    selectedUrls: string[];
    options: MetadataExtractOptions;
    setOptions: (opts: MetadataExtractOptions) => void;
    maxConcurrent: number;
    setMaxConcurrent: (v: number) => void;
    requestDelay: number;
    setRequestDelay: (v: number) => void;
    isExtracting: boolean;
    isStopping: boolean;
    hasStopped: boolean;
    hasCompleted: boolean;
    completedTableId: number | null;
    stoppedTableId: number | null;
    completedCount: number;
    totalCount: number;
    activeTabs: number;
    urlStatuses: UrlStatus[];
    previewTableId: number | null;
    onStart: () => void;
    onStop: () => void;
    onBack: () => void;
    onViewResults: (tableId: number) => void;
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-text-primary">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${checked ? 'bg-primary' : 'bg-surface-darker'}`}
            >
                <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${checked ? 'translate-x-3' : 'translate-x-0'}`} />
            </button>
        </div>
    );
}

function NumInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
    return (
        <div className="flex items-center gap-1">
            <button onClick={() => onChange(Math.max(min, value - step))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary hover:bg-border-subtle flex items-center justify-center text-xs leading-none">−</button>
            <span className="text-xs font-mono text-text-primary w-8 text-center tabular-nums">{value}</span>
            <button onClick={() => onChange(Math.min(max, value + step))} className="w-5 h-5 rounded bg-surface-darker text-text-muted hover:text-text-primary hover:bg-border-subtle flex items-center justify-center text-xs leading-none">+</button>
        </div>
    );
}

export function MetadataStep2Run({
    selectedUrls,
    options,
    setOptions,
    maxConcurrent,
    setMaxConcurrent,
    requestDelay,
    setRequestDelay,
    isExtracting,
    isStopping,
    hasStopped,
    hasCompleted,
    completedTableId,
    stoppedTableId,
    completedCount,
    totalCount,
    activeTabs,
    urlStatuses,
    previewTableId,
    onStart,
    onStop,
    onBack,
    onViewResults,
    onReset,
}: MetadataStep2RunProps) {
    const { t } = useTranslation('metadataExtractor');

    const resultTableId = completedTableId ?? stoppedTableId;
    const isDone = hasCompleted || hasStopped;
    const isActive = isExtracting || isStopping;

    const extractingUrls = urlStatuses.filter(u => u.status === 'extracting');
    const errorUrls = urlStatuses.filter(u => u.status === 'error');

    return (
        <div className="space-y-4 animate-fade-in-up">
            <div className="card text-center p-6 mt-4">
                <Database className="w-10 h-10 text-primary mx-auto mb-3 opacity-80" />
                <h2 className="text-lg font-bold mb-1">{t('step2.title')}</h2>
                <p className="text-text-muted mb-5 text-sm">
                    {t('step2.subtitle')} — {selectedUrls.length} {selectedUrls.length === 1 ? 'URL' : 'URLs'}
                </p>

                {/* Pre-run: options */}
                {!isActive && !isDone && (
                    <div className="max-w-xs mx-auto text-left mb-6">
                        <div className="bg-surface-lighter rounded-lg border border-border-subtle overflow-hidden text-sm">
                            <div className="px-4 pt-3 pb-2 space-y-2.5">
                                <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">{t('options.title')}</span>
                                <Toggle
                                    label={t('options.includeLinks')}
                                    checked={options.includeLinks ?? true}
                                    onChange={v => setOptions({ ...options, includeLinks: v })}
                                />
                                <Toggle
                                    label={t('options.includeImages')}
                                    checked={options.includeImages ?? false}
                                    onChange={v => setOptions({ ...options, includeImages: v })}
                                />
                                <Toggle
                                    label={t('options.outputText')}
                                    checked={options.outputText ?? false}
                                    onChange={v => setOptions({ ...options, outputText: v })}
                                />
                            </div>

                            <div className="border-t border-border-subtle px-4 py-3 space-y-2.5">
                                <span className="text-[11px] font-semibold text-text-primary uppercase tracking-wider block">Performance</span>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-text-primary">{t('options.concurrency')}</p>
                                        <p className="text-[10px] text-text-muted leading-tight">{t('options.concurrencyHint')}</p>
                                    </div>
                                    <NumInput value={maxConcurrent} onChange={setMaxConcurrent} min={1} max={5} step={1} />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs text-text-primary">{t('options.requestDelay')}</p>
                                        <p className="text-[10px] text-text-muted leading-tight">{t('options.requestDelayHint')}</p>
                                    </div>
                                    <NumInput value={requestDelay} onChange={setRequestDelay} min={0} max={10000} step={500} />
                                </div>
                            </div>

                            <p className="text-[10px] text-text-muted px-4 pb-3 leading-tight">
                                Extraction runs in a background window. You can continue browsing normally.
                            </p>
                        </div>

                        {/* What will be extracted chips */}
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {[
                                { icon: <FileText size={9} />, label: 'Title · Author · Description' },
                                { icon: <Link size={9} />, label: 'Metadata · Page Type' },
                                { icon: <Database size={9} />, label: 'Markdown Content' },
                            ].map(({ icon, label }) => (
                                <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] border border-primary/20">
                                    {icon}{label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Live extraction panel — matches PageExtractor Step3Review style */}
                {isActive && (
                    <div className="mb-6 rounded-lg border border-accent-ai/30 bg-accent-ai/5 text-left max-w-sm mx-auto overflow-hidden">
                        {/* Progress header + bar */}
                        <div className="px-5 pt-5 pb-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-text-primary flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-accent-ai animate-spin" />
                                    {isStopping ? t('results.stopping') : t('results.extracting')}
                                </span>
                                <span className="text-xs font-bold text-accent-ai tabular-nums">
                                    {completedCount} / {totalCount}
                                </span>
                            </div>
                            <div className="w-full bg-surface-darker h-2 rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="bg-gradient-to-r from-accent-ai to-primary h-full transition-all duration-500 rounded-full"
                                    style={{ width: `${Math.max(4, totalCount > 0 ? (completedCount / totalCount) * 100 : 0)}%` }}
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

                        {/* Error URLs */}
                        {errorUrls.length > 0 && (
                            <div className="border-t border-accent-error/20 px-5 py-2 space-y-1">
                                {errorUrls.slice(0, 3).map((u, i) => (
                                    <div key={i} className="flex items-center gap-1 text-[10px] text-accent-error">
                                        <span className="w-1.5 h-1.5 rounded-full bg-accent-error flex-shrink-0" />
                                        <span className="truncate font-mono">{shortUrl(u.url)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Completion card — matches PageExtractor style */}
                {isDone && (
                    <div className="w-full max-w-sm mx-auto">
                        <div className="rounded-xl border border-accent-ai/30 bg-accent-ai/5 px-5 py-5 mb-4 text-center">
                            <CheckCircle2 className="w-8 h-8 text-accent-ai mx-auto mb-2" />
                            <p className="text-sm font-semibold text-text-primary">
                                {hasStopped ? t('results.stoppedSummary', { count: completedCount }) : t('results.completeSummary', { count: completedCount })}
                            </p>
                            <p className="text-xs text-text-muted mt-1">
                                {hasStopped ? 'Partial results are available.' : 'All pages extracted successfully.'}
                            </p>
                        </div>

                        <div className="space-y-3">
                            {resultTableId != null && (
                                <button
                                    onClick={() => onViewResults(resultTableId)}
                                    className="btn btn-primary w-full h-11 text-sm"
                                >
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    {t('results.viewResults')}
                                </button>
                            )}
                            <button onClick={onReset} className="btn btn-ghost w-full h-10 text-sm text-text-muted">
                                <RotateCcw className="w-4 h-4 mr-2" />
                                {t('results.reset')}
                            </button>
                        </div>
                    </div>
                )}

                {/* Pre-run action buttons */}
                {!isActive && !isDone && (
                    <>
                        <button
                            onClick={onStart}
                            disabled={selectedUrls.length === 0}
                            className="btn btn-primary w-full max-w-sm mx-auto h-12 shadow-lg shadow-primary/20 text-base"
                        >
                            <Database className="w-5 h-5 mr-2" />
                            {t('step2.extract', { count: selectedUrls.length })}
                        </button>
                        <button
                            onClick={onBack}
                            className="btn btn-ghost text-sm mt-4 inline-flex justify-center w-full max-w-sm mx-auto"
                        >
                            {t('back')}
                        </button>
                    </>
                )}

                {/* Active: Stop + Live Preview */}
                {isActive && (
                    <div className="w-full max-w-sm mx-auto space-y-3">
                        <button
                            onClick={onStop}
                            disabled={isStopping}
                            className="btn btn-secondary text-accent-error border-accent-error/30 hover:bg-accent-error/10 w-full h-12 shadow-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <Loader2 className="w-5 h-5 mr-2 animate-spin text-accent-error" />
                            {isStopping ? t('results.stopping') : t('results.stop')}
                        </button>
                        {previewTableId != null && (
                            <button
                                onClick={() => onViewResults(previewTableId)}
                                className="btn btn-ghost w-full h-10 text-sm border border-accent-ai/30 hover:bg-accent-ai/10 text-accent-ai"
                            >
                                <ExternalLink className="w-4 h-4 mr-2" />
                                {t('results.previewResults')} ({completedCount} {completedCount === 1 ? 'page' : 'pages'} so far)
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
