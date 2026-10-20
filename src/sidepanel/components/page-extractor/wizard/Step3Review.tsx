import { Play, Settings2, ExternalLink, RotateCcw, PartyPopper, ShieldAlert, Square } from 'lucide-react';
import { SiteSettingsCard } from '../../sites/SiteSettingsCard';
import { siteOf } from '../../../../shared/sites/siteSettings';
import { Button, Card, Chip, Disclosure, Heading, Notice, Progress, Segmented, Spinner, Stack, Stepper, Switch, Text } from '../../../ui';
import type { UrlStatus } from '../../../../shared/messages';
import { VERDICT_LABELS } from '../../../../shared/verdict/classifyPage';
import { defaultConcurrency, tabsHint } from '../../../../shared/utils/concurrency';

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

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <Text size="small" weight="medium">{label}</Text>
                {hint && <Text size="caption" tone="muted">{hint}</Text>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
            <Text size="caption" weight="bold" tone="muted">{title}</Text>
            {children}
        </div>
    );
}

const LIST_OUTPUT_LABELS = { nested: 'One column', rows: 'Row per item', numbered: 'Numbered' } as const;
const LIST_OUTPUT_HINTS = {
    nested: 'Each list is one JSON column holding all its items',
    rows: 'One row per item of the first list; the page’s other fields repeat on each row',
    numbered: 'Field 1 … Field 10 columns (the first 10 items)',
} as const;

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

    const done = hasCompleted || hasStopped;
    const doneTable = hasCompleted ? completedTableId : stoppedTableId;

    const summary = (label: string, value: React.ReactNode) => (
        <div className="flex items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0">
            <Text size="small" tone="muted">{label}</Text>
            <Text weight="bold">{value}</Text>
        </div>
    );

    return (
        <Stack gap={4} className="animate-slide-up">
            {!done && (
                <div>
                    <Heading size="heading">Review & run</Heading>
                    <Text size="small" tone="muted" className="mt-0.5">
                        {extractFieldCount} field{extractFieldCount !== 1 ? 's' : ''} from {selectedUrls.length} page{selectedUrls.length !== 1 ? 's' : ''}{clickActionCount > 0 ? `, with ${clickActionCount} click${clickActionCount !== 1 ? 's' : ''}` : ''}.
                    </Text>
                </div>
            )}

            {!done && (
                <Card pad="sm" className="px-4 py-1">
                    {summary('Pages', selectedUrls.length)}
                    {duplicatesRemoved > 0 && summary('Unique pages', <>{selectedUrls.length - duplicatesRemoved} <span className="text-caption font-normal text-ink-3">({duplicatesRemoved} duplicate{duplicatesRemoved !== 1 ? 's' : ''} skipped)</span></>)}
                    {summary('Fields per page', extractFieldCount)}
                    {clickActionCount > 0 && summary('Clicks', clickActionCount)}
                </Card>
            )}

            {!isActive && !done && <SiteSettingsCard site={siteOf(selectedUrls[0])} />}

            {!isActive && !done && (
                <Disclosure icon={<Settings2 />} summary="More settings for this run">
                    <div className="flex flex-col gap-4">
                        <Group title="Speed">
                            <SettingRow label="Tabs at a time" hint={tabsHint(maxConcurrent, defaultConcurrency())}>
                                <Stepper label="Tabs at a time" value={maxConcurrent} onChange={setMaxConcurrent} min={1} max={5} step={1} width={1} />
                            </SettingRow>
                            <SettingRow label="Wait between pages" hint="Milliseconds">
                                <Stepper label="Wait between pages" value={requestDelay} onChange={setRequestDelay} min={0} max={10000} step={500} />
                            </SettingRow>
                            <SettingRow label="Wait after a click" hint="Milliseconds">
                                <Stepper label="Wait after a click" value={clickWaitMs} onChange={setClickWaitMs} min={500} max={10000} step={500} />
                            </SettingRow>
                        </Group>
                        <Group title="Page loading">
                            <Switch checked={waitForLoad} onChange={setWaitForLoad} label="Wait for the page to load" hint="Read it only once it has fully loaded" />
                            {waitForLoad && (
                                <SettingRow label="Load timeout" hint="Longest wait (ms)">
                                    <Stepper label="Load timeout" value={loadTimeout} onChange={setLoadTimeout} min={1000} max={60000} step={1000} />
                                </SettingRow>
                            )}
                        </Group>
                        <Group title="Bot checks">
                            <Switch checked={enableRandomization} onChange={setEnableRandomization} label="Vary the timing" hint="Random jitter on each wait, so runs look less robotic" />
                            <SettingRow label="Per-site gap" hint="Least time between two pages of one site, across all tabs (ms)">
                                <Stepper label="Per-site gap" value={domainMinGapMs} onChange={setDomainMinGapMs} min={0} max={60000} step={500} />
                            </SettingRow>
                            <Switch checked={pauseOnChallenge} onChange={setPauseOnChallenge} label="Pause on a bot check" hint="Show the tab and wait for you to solve a CAPTCHA, then continue" />
                        </Group>
                        {elements.some((e: any) => e.type === 'list' || e.type === 'smart') && (
                            <Group title="Lists">
                                <Segmented size="sm" fullWidth aria-label="List output" value={listOutput} onChange={setListOutput}
                                    options={(['nested', 'rows', 'numbered'] as const).map(m => ({ value: m, label: LIST_OUTPUT_LABELS[m] }))} />
                                <Text size="caption" tone="muted">{LIST_OUTPUT_HINTS[listOutput]}</Text>
                            </Group>
                        )}
                        <Group title="Waiting for elements">
                            <Switch checked={waitForElements} onChange={setWaitForElements} label="Wait for the fields to appear" hint="Useful when the page fills itself in after loading" />
                            {waitForElements && (
                                <SettingRow label="Element timeout" hint="Longest wait (ms, 0 = 5 s)">
                                    <Stepper label="Element timeout" value={elementTimeout} onChange={setElementTimeout} min={0} max={30000} step={1000} />
                                </SettingRow>
                            )}
                        </Group>
                        <Text size="caption" tone="faint">The run uses a background window, so you can keep browsing.</Text>
                    </div>
                </Disclosure>
            )}

            {isActive && (
                <Card raised pad="none" className="overflow-hidden">
                    <div className="p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <Text weight="semibold" className="flex items-center gap-2"><Spinner size={15} />{isStopping ? 'Stopping…' : 'Reading the pages'}</Text>
                            <span className="font-display text-lead font-extrabold text-ink tabular-nums">{completedPages} / {totalUniquePages}</span>
                        </div>
                        <Progress value={Math.max(4, (completedPages / (totalUniquePages || 1)) * 100)} label="Pages read" />
                        {activeTabs > 0 && !isStopping && <Text size="caption" tone="muted" className="mt-1.5">{activeTabs} background tab{activeTabs > 1 ? 's' : ''} working</Text>}
                    </div>
                    {!isStopping && extractingUrls.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line px-4 py-2.5">
                            {extractingUrls.map(u => (
                                <div key={u.url} className="flex items-center gap-2">
                                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" />
                                    <span className="truncate font-mono text-caption text-ink-2">{shortUrl(u.url)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {waitingUrls.length > 0 && (
                        <Notice tone="warning" icon={<ShieldAlert />} className="rounded-none">
                            {waitingUrls.length === 1 ? 'A page is' : `${waitingUrls.length} pages are`} asking to verify you are human.
                            Solve it in the tab that was brought to the front; the run continues by itself.
                        </Notice>
                    )}
                    {errorUrls.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line px-4 py-2.5">
                            <div className="flex flex-wrap gap-1 pb-1">
                                {Object.entries(verdictCounts).map(([label, n]) => <Chip key={label} tone="danger">{label} · {n}</Chip>)}
                            </div>
                            {errorUrls.slice(0, 3).map((u, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-caption text-danger" title={u.error}>
                                    <span className="size-1.5 shrink-0 rounded-full bg-danger" />
                                    <span className="truncate font-mono">{shortUrl(u.url)}</span>
                                    {u.error && <span className="truncate text-ink-3">— {u.error}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {isActive ? (
                <Stack gap={2}>
                    <Button variant="danger" size="lg" fullWidth icon={<Square />} onClick={onStop} disabled={isStopping}>{isStopping ? 'Stopping…' : 'Stop'}</Button>
                    {previewTableId != null && (
                        <Button fullWidth icon={<ExternalLink />} onClick={() => onViewPartialResults(previewTableId)}>
                            Live preview ({completedPages} page{completedPages !== 1 ? 's' : ''} so far)
                        </Button>
                    )}
                </Stack>
            ) : done ? (
                <Stack gap={3}>
                    <Card tone="brand" raised className="animate-pop">
                        <div className="flex items-start gap-3">
                            <span className="flex size-10 shrink-0 rotate-6 items-center justify-center rounded-xl bg-surface text-ink"><PartyPopper size={20} /></span>
                            <div>
                                <Heading size="heading" className="text-on-brand!">{hasCompleted ? 'Done!' : 'Stopped'}</Heading>
                                <Text size="small" tone="inherit" className="opacity-80">
                                    {completedPages} page{completedPages !== 1 ? 's' : ''} read{hasCompleted ? '' : ' before stopping'}
                                </Text>
                            </div>
                        </div>
                    </Card>
                    {doneTable != null && (
                        <Button variant="primary" size="lg" fullWidth icon={<ExternalLink />} onClick={() => onViewPartialResults(doneTable)}>Open the table</Button>
                    )}
                    <Button fullWidth icon={<RotateCcw />} onClick={onReset}>Start over</Button>
                </Stack>
            ) : (
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                    <Button variant="ghost" onClick={onBack}>Back</Button>
                    <Button variant="primary" size="lg" icon={<Play />} onClick={handleStartExtraction} disabled={selectedUrls.length === 0 || elements.length === 0}>
                        Get {selectedUrls.length} page{selectedUrls.length !== 1 ? 's' : ''}
                    </Button>
                </div>
            )}
        </Stack>
    );
}
