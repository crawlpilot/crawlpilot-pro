import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';
import { Box, CircularProgress, Typography } from '@mui/material';
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
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2 }}>
                    <CircularProgress size={40} />
                    <Typography variant="body1" color="text.secondary">{t('readingPage')}</Typography>
                </Box>
            ) : !doc ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2 }}>
                    <Typography variant="body1" color="text.secondary">{t('noTextFound')}</Typography>
                </Box>
            ) : (
                <Step2SummaryChat doc={doc} onBack={onBack || (() => {})} />
            )}
        </WizardLayout>
    );
}
