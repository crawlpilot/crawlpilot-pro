import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';
import { Spinner, Text } from '../ui';
import { extractActiveTabContent } from '../services/extraction/pageContent';
import type { ExtractedContent } from '@/shared/types/summarizer';

interface TextSummarizerPageProps {
    onBack?: () => void;
}

export default function TextSummarizerPage({ onBack }: TextSummarizerPageProps) {
    const { t } = useTranslation('summarizer');
    const [doc, setDoc] = useState<ExtractedContent | null>(null);
    const [isExtracting, setIsExtracting] = useState(true);

    useEffect(() => {
        let isMounted = true;

        extractActiveTabContent()
            .then((content) => {
                if (isMounted) setDoc(content);
            })
            .finally(() => {
                if (isMounted) setIsExtracting(false);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    return (
        <WizardLayout
            title={t('title')}
            subtitle={t('subtitle')}
            currentStep={1}
            totalSteps={1}
            onBack={onBack}
        >
            {isExtracting ? (
                <div className="flex flex-col items-center justify-center gap-3 p-12 text-ink-2">
                    <Spinner size={32} />
                    <Text tone="muted">{t('readingPage')}</Text>
                </div>
            ) : !doc ? (
                <div className="flex flex-col items-center justify-center p-12">
                    <Text tone="muted">{t('noTextFound')}</Text>
                </div>
            ) : (
                <Step2SummaryChat doc={doc} onBack={onBack || (() => {})} />
            )}
        </WizardLayout>
    );
}
