import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';
import { Box, CircularProgress, Typography } from '@mui/material';

interface TextSummarizerPageProps {
    onBack?: () => void;
}

export default function TextSummarizerPage({ onBack }: TextSummarizerPageProps) {
    const { t } = useTranslation('summarizer');
    const [selectedText, setSelectedText] = useState<string>('');
    const [isExtracting, setIsExtracting] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const extractMainContent = async () => {
            try {
                let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tabs || tabs.length === 0) {
                    tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                }
                const tabId = tabs[0]?.id;

                if (!tabId) {
                    console.warn("No active tab found to extract from.");
                    if (isMounted) setIsExtracting(false);
                    return;
                }

                console.log("Extracting text from tabId:", tabId, "URL:", tabs[0]?.url);

                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        try {
                            // Score every candidate instead of taking the first
                            // selector match — a short sidebar/nav block matching
                            // an earlier selector shouldn't win over the real
                            // article body matched by a later one.
                            const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
                            let best = '';
                            for (const sel of selectors) {
                                document.querySelectorAll(sel).forEach((el) => {
                                    const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
                                    if (text.length > best.length) best = text;
                                });
                            }
                            if (best.length > 200) return best.substring(0, 40000);

                            // Fallback to body
                            const bodyText = (document.body?.innerText || document.body?.textContent || '').trim();
                            return bodyText.substring(0, 40000);
                        } catch (e) {
                            return 'Error during extraction: ' + (e as Error).message;
                        }
                    }
                });

                if (isMounted && results && results[0]?.result) {
                    console.log("Extracted text successfully, length:", results[0].result.length);
                    setSelectedText(results[0].result);
                } else {
                    console.warn("Script executed but returned empty or no result.");
                }
            } catch (err) {
                console.error('Auto text extraction failed (possibly a chrome:// or protected page?):', err);
            } finally {
                if (isMounted) {
                    setIsExtracting(false);
                }
            }
        };

        extractMainContent();

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
            ) : (
                <Step2SummaryChat
                    selectedText={selectedText || t('noTextFound')}
                    onBack={onBack || (() => {})}
                />
            )}
        </WizardLayout>
    );
}
