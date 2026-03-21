import { useEffect, useState } from 'react';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';
import { Box, CircularProgress, Typography } from '@mui/material';

interface TextSummarizerPageProps {
    onBack?: () => void;
}

export default function TextSummarizerPage({ onBack }: TextSummarizerPageProps) {
    const [selectedText, setSelectedText] = useState<string>('');
    const [isExtracting, setIsExtracting] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const extractMainContent = async () => {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tabId = tabs[0]?.id;

                if (!tabId) {
                    if (isMounted) setIsExtracting(false);
                    return;
                }

                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        // Heuristic to find the best text section
                        const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
                        for (const sel of selectors) {
                            const el = document.querySelector(sel) as HTMLElement;
                            if (el && el.innerText.trim().length > 200) {
                                return el.innerText.trim();
                            }
                        }
                        
                        // Fallback to body
                        return document.body.innerText.trim();
                    }
                });

                if (isMounted && results && results[0]?.result) {
                    setSelectedText(results[0].result);
                }
            } catch (err) {
                console.error('Auto text extraction failed:', err);
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
            title="Page Summarizer"
            subtitle="Summary and Chat"
            currentStep={1}
            totalSteps={1}
            onBack={onBack}
        >
            {isExtracting ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 6, gap: 2 }}>
                    <CircularProgress size={40} />
                    <Typography variant="body1" color="text.secondary">Reading page content...</Typography>
                </Box>
            ) : (
                <Step2SummaryChat
                    selectedText={selectedText || 'No text found on this page.'}
                    onBack={onBack || (() => {})}
                />
            )}
        </WizardLayout>
    );
}
