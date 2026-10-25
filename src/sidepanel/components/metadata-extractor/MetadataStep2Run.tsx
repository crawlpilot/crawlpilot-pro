import { useTranslation } from 'react-i18next';
import { Database, ExternalLink, FileText, Link, PartyPopper, Play, RotateCcw, Square } from 'lucide-react';
import { Button, Card, Chip, Heading, Progress, Spinner, Stack, Stepper, Switch, Text } from '../../ui';
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

    const row = (label: string, hint: string, control: React.ReactNode) => (
        <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
                <Text size="small" weight="medium">{label}</Text>
                <Text size="caption" tone="muted">{hint}</Text>
            </div>
            {control}
        </div>
    );

    return (
        <Stack gap={4} className="animate-slide-up">
            {!isDone && (
                <div>
                    <Heading size="heading">{t('step2.title')}</Heading>
                    <Text size="small" tone="muted" className="mt-0.5">{t('step2.subtitle')}</Text>
                </div>
            )}

            {!isActive && !isDone && (
                <>
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { icon: <FileText />, label: 'Title · Author · Description' },
                            { icon: <Link />, label: 'Metadata · Page type' },
                            { icon: <Database />, label: 'Markdown content' },
                        ].map(({ icon, label }) => <Chip key={label} size="md" icon={icon}>{label}</Chip>)}
                    </div>
                    <Card className="flex flex-col gap-3.5">
                        <Text size="caption" weight="bold" tone="muted">{t('options.title')}</Text>
                        <Switch label={t('options.includeLinks')} checked={options.includeLinks ?? true} onChange={v => setOptions({ ...options, includeLinks: v })} />
                        <Switch label={t('options.includeImages')} checked={options.includeImages ?? false} onChange={v => setOptions({ ...options, includeImages: v })} />
                        <Switch label={t('options.outputText')} checked={options.outputText ?? false} onChange={v => setOptions({ ...options, outputText: v })} />
                        <Switch label={t('options.reveal')} hint={t('options.revealHint')} checked={(options.reveal ?? 'open') !== 'off'} onChange={v => setOptions({ ...options, reveal: v ? 'open' : 'off' })} />
                        <div className="border-t border-line pt-3.5"><Text size="caption" weight="bold" tone="muted">Speed</Text></div>
                        {row(t('options.concurrency'), t('options.concurrencyHint'),
                            <Stepper label={t('options.concurrency')} value={maxConcurrent} onChange={setMaxConcurrent} min={1} max={5} step={1} width={1} />)}
                        {row(t('options.requestDelay'), t('options.requestDelayHint'),
                            <Stepper label={t('options.requestDelay')} value={requestDelay} onChange={setRequestDelay} min={0} max={10000} step={500} />)}
                        <Text size="caption" tone="faint">The run uses a background window, so you can keep browsing.</Text>
                    </Card>
                </>
            )}

            {isActive && (
                <Card raised pad="none" className="overflow-hidden">
                    <div className="p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <Text weight="semibold" className="flex items-center gap-2"><Spinner size={15} />{isStopping ? t('results.stopping') : t('results.extracting')}</Text>
                            <span className="font-display text-lead font-extrabold text-ink tabular-nums">{completedCount} / {totalCount}</span>
                        </div>
                        <Progress value={Math.max(4, totalCount > 0 ? (completedCount / totalCount) * 100 : 0)} label={t('results.extracting')} />
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
                    {errorUrls.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line px-4 py-2.5">
                            {errorUrls.slice(0, 3).map((u, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-caption text-danger">
                                    <span className="size-1.5 shrink-0 rounded-full bg-danger" />
                                    <span className="truncate font-mono">{shortUrl(u.url)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {isDone && (
                <Stack gap={3}>
                    <Card tone="brand" raised className="animate-pop">
                        <div className="flex items-start gap-3">
                            <span className="flex size-10 shrink-0 rotate-6 items-center justify-center rounded-xl bg-surface text-ink"><PartyPopper size={20} /></span>
                            <div>
                                <Heading size="heading" className="text-on-brand!">
                                    {hasStopped ? t('results.stoppedSummary', { count: completedCount }) : t('results.completeSummary', { count: completedCount })}
                                </Heading>
                                <Text size="small" tone="inherit" className="opacity-80">{hasStopped ? 'Partial results are available.' : 'Every page was read.'}</Text>
                            </div>
                        </div>
                    </Card>
                    {resultTableId != null && (
                        <Button variant="primary" size="lg" fullWidth icon={<ExternalLink />} onClick={() => onViewResults(resultTableId)}>{t('results.viewResults')}</Button>
                    )}
                    <Button fullWidth icon={<RotateCcw />} onClick={onReset}>{t('results.reset')}</Button>
                </Stack>
            )}

            {!isActive && !isDone && (
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                    <Button variant="ghost" onClick={onBack}>{t('back')}</Button>
                    <Button variant="primary" size="lg" icon={<Play />} onClick={onStart} disabled={selectedUrls.length === 0}>{t('step2.extract', { count: selectedUrls.length })}</Button>
                </div>
            )}

            {isActive && (
                <Stack gap={2}>
                    <Button variant="danger" size="lg" fullWidth icon={<Square />} onClick={onStop} disabled={isStopping}>{isStopping ? t('results.stopping') : t('results.stop')}</Button>
                    {previewTableId != null && (
                        <Button fullWidth icon={<ExternalLink />} onClick={() => onViewResults(previewTableId)}>{t('results.previewResults')} ({completedCount})</Button>
                    )}
                </Stack>
            )}
        </Stack>
    );
}
