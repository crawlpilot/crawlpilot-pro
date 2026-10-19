import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step1Urls } from '../components/page-extractor/wizard/Step1Urls';
import { MetadataStep2Run } from '../components/metadata-extractor/MetadataStep2Run';
import DataSourceSelector from '../components/DataSourceSelector';
import { useMetadataExtraction } from '../hooks/useMetadataExtraction';
import type { MetadataExtractOptions } from '../../shared/types/metadata';

interface MetadataExtractorPageProps {
    onBack: () => void;
}

export default function MetadataExtractorPage({ onBack }: MetadataExtractorPageProps) {
    const { t } = useTranslation('metadataExtractor');

    const [step, setStep] = useState(1);
    const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
    const [showDataSourceSelector, setShowDataSourceSelector] = useState(false);

    const [options, setOptions] = useState<MetadataExtractOptions>({
        includeLinks: true,
        includeTables: true,
        includeImages: false,
        includeMetadata: true,
        outputText: false,
    });
    const [maxConcurrent, setMaxConcurrent] = useState(3);
    const [requestDelay, setRequestDelay] = useState(1000);

    const {
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
        startMetadataExtraction,
        stopMetadataExtraction,
        resetState,
    } = useMetadataExtraction();

    const handleRemoveUrl = useCallback((index: number) => {
        setSelectedUrls(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleStart = useCallback(() => {
        startMetadataExtraction(selectedUrls, options, { maxConcurrent, requestDelay });
    }, [selectedUrls, options, maxConcurrent, requestDelay, startMetadataExtraction]);

    const handleViewResults = useCallback((tableId: number) => {
        const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
        chrome.tabs.create({ url });
    }, []);

    const handleReset = useCallback(() => {
        setStep(1);
        setSelectedUrls([]);
        resetState();
    }, [resetState]);

    if (showDataSourceSelector) {
        return (
            <DataSourceSelector
                onClose={() => setShowDataSourceSelector(false)}
                onSelect={(urls: string[]) => {
                    setSelectedUrls(urls);
                    setShowDataSourceSelector(false);
                }}
            />
        );
    }

    const renderStep = () => {
        switch (step) {
            case 1:
                return (
                    <Step1Urls
                        selectedUrls={selectedUrls}
                        setSelectedUrls={setSelectedUrls}
                        setShowDataSourceSelector={setShowDataSourceSelector}
                        handleRemoveUrl={handleRemoveUrl}
                        onNext={() => setStep(2)}
                    />
                );
            case 2:
                return (
                    <MetadataStep2Run
                        selectedUrls={selectedUrls}
                        options={options}
                        setOptions={setOptions}
                        maxConcurrent={maxConcurrent}
                        setMaxConcurrent={setMaxConcurrent}
                        requestDelay={requestDelay}
                        setRequestDelay={setRequestDelay}
                        isExtracting={isExtracting}
                        isStopping={isStopping}
                        hasStopped={hasStopped}
                        hasCompleted={hasCompleted}
                        completedTableId={completedTableId}
                        stoppedTableId={stoppedTableId}
                        completedCount={completedCount}
                        totalCount={totalCount}
                        activeTabs={activeTabs}
                        urlStatuses={urlStatuses}
                        previewTableId={previewTableId}
                        onStart={handleStart}
                        onStop={stopMetadataExtraction}
                        onBack={() => setStep(1)}
                        onViewResults={handleViewResults}
                        onReset={handleReset}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <WizardLayout
            title={t('title')}
            subtitle={step === 1 ? t('step1.subtitle') : t('step2.subtitle')}
            currentStep={step}
            totalSteps={2}
            onBack={step === 1 ? onBack : () => setStep(step - 1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
