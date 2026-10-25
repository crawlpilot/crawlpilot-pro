import { ListPick, PaginationMode } from '../../../../shared/types/extraction';
import { Play, RotateCcw, PartyPopper, FileSearch } from 'lucide-react';
import { ExtractionStatusBar } from '../ExtractionStatusBar';
import { SiteSettingsCard } from '../../sites/SiteSettingsCard';
import { Button, Card, Divider, Heading, Notice, Row, Stack, Text, TextField } from '../../../ui';
import { useTranslation } from 'react-i18next';

interface Step3ReviewProps {
    paginationMode: PaginationMode;
    selectors: ListPick[];
    onStart: () => void;
    onBack: () => void;
    isExtracting: boolean;
    status: any;
    onStop: (force?: boolean) => void;
    onReset: () => void; // [NEW] Reset callback
    maxPages: number;
    onMaxPagesChange: (pages: number) => void;
    /** The list run ended: open each item's page and add its fields to this table. */
    onAddDetails?: () => void;
    detailsError?: string | null;
    /** The list's site: its settings are shown before the run. */
    site?: string;
}

export function Step3Review({
    paginationMode,
    selectors,
    onStart,
    onBack,
    isExtracting,
    status,
    onStop,
    onReset,
    maxPages,
    onMaxPagesChange,
    onAddDetails,
    detailsError,
    site,
}: Step3ReviewProps) {

    const { t } = useTranslation('listExtractor');

    const ended = !isExtracting && (status?.status === 'completed' || status?.status === 'stopped');
    const fieldCount = selectors[0]?.data?.columns?.length ?? selectors.length;

    return (
        <Stack gap={4} className="animate-fade-in">
            {ended && (
                <Card tone="brand" raised className="animate-pop">
                    <Row gap={2.5} align="start">
                        <span className="flex size-10 shrink-0 rotate-6 items-center justify-center rounded-xl bg-surface text-ink"><PartyPopper size={20} /></span>
                        <div className="min-w-0">
                            <Heading size="heading" className="text-on-brand!">
                                {status.status === 'stopped' ? t('step3.stoppedTitle', { count: status.itemsSaved ?? 0 }) : t('step3.doneTitle', { count: status.itemsSaved ?? 0 })}
                                {status.pagesVisited ? ` ${t('step3.donePages', { count: status.pagesVisited })}` : ''}
                            </Heading>
                            <Text size="small" tone="inherit" className="mt-0.5 opacity-80">{t('step3.doneHint')}</Text>
                        </div>
                    </Row>
                </Card>
            )}

            {!isExtracting && !ended && (
                <div>
                    <Heading size="heading">{t('step3.reviewAndRun')}</Heading>
                    <Text size="small" tone="muted" className="mt-0.5">{t('step3.checkConfig')}</Text>
                </div>
            )}

            {!ended && (
                <Card pad="none">
                    <Text size="small" weight="semibold" tone="muted" className="border-b border-line px-4 py-2.5">{t('step3.summary')}</Text>
                    <div className="px-4 py-2.5">
                        <Text size="caption" tone="muted">{t('step3.fieldsSelected')}</Text>
                        <Text weight="semibold">{t('step3.fieldsDetail', { count: fieldCount, items: selectors[0]?.count || 0 })}</Text>
                    </div>
                    <Divider />
                    <div className="px-4 py-2.5">
                        {paginationMode === 'pagination' && !isExtracting ? (
                            <TextField type="number" min={1} size="sm" label={t('step3.maxPagesToExtract')} hint={t('step3.maxPagesHelper')} value={maxPages}
                                onChange={e => onMaxPagesChange(Math.max(1, parseInt(e.target.value) || 1))} />
                        ) : (
                            <>
                                <Text size="caption" tone="muted">{t('step3.pageLimit')}</Text>
                                <Text weight="semibold">{paginationMode === 'pagination' ? t('step3.pages', { count: maxPages }) : t('step3.singlePage')}</Text>
                            </>
                        )}
                    </div>
                </Card>
            )}

            {isExtracting && (
                <div className="animate-slide-up">
                    <ExtractionStatusBar
                        status={status}
                        onStop={onStop}
                        onStart={onStart}
                        hasSelectors={selectors.length > 0}
                        selectorCount={selectors.length}
                        showStartButton={false}
                    />
                    {/* The run lives in this panel until list runs move to the background (#41). */}
                    <Text size="caption" tone="muted" className="mt-2" data-testid="keep-panel-open">{t('step3.keepPanelOpen')}</Text>
                </div>
            )}

            {!isExtracting && status?.status !== 'failed' && status?.stopReason === 'no_access' && status.error && (
                <Notice tone="warning">{status.error}</Notice>
            )}

            {!isExtracting && status?.status === 'failed' && (
                <Notice tone="danger" title={t('step3.extractionFailed')}>{status.error || t('step3.unknownError')}</Notice>
            )}

            {!isExtracting && (status?.status === 'idle' || !status?.status) && site && <SiteSettingsCard site={site} />}

            {!isExtracting && (status?.status === 'idle' || !status?.status) && (
                <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
                    <Button variant="ghost" onClick={onBack}>{t('step3.back')}</Button>
                    <Button variant="primary" size="lg" onClick={onStart} icon={<Play />}>{t('step3.startExtraction')}</Button>
                </div>
            )}

            {!isExtracting && (status?.status === 'completed' || status?.status === 'stopped' || status?.status === 'failed') && (
                <Stack gap={2} className="mt-auto border-t border-line pt-4">
                    <Button variant="primary" size="lg" fullWidth
                        onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table${status?.tableId ? `&tableId=${status.tableId}` : ''}`) })}>
                        {t('step3.openResultsTable')}
                    </Button>
                    {onAddDetails && status?.tableId && status?.status !== 'failed' && (
                        <>
                            <Button fullWidth icon={<FileSearch />} onClick={onAddDetails}>{t('step3.addDetails')}</Button>
                            <Text size="caption" tone="muted">{t('step3.addDetailsHint')}</Text>
                            {detailsError && <Notice tone="warning">{detailsError}</Notice>}
                        </>
                    )}
                    <Button fullWidth icon={<RotateCcw />} onClick={onReset}>{t('step3.newExtraction')}</Button>
                </Stack>
            )}
        </Stack>
    );
}
