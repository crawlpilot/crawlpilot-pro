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
                            const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content'];
                            for (const sel of selectors) {
                                const el = document.querySelector(sel) as HTMLElement;
                                if (el) {
                                    const text = (el.innerText || el.textContent || '').trim();
                                    if (text.length > 200) return text;
                                }
                            }
                            // Fallback to body
                            return (document.body?.innerText || document.body?.textContent || '').trim();
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
