import { useEffect, useState } from 'react';
import { useSelectorManager } from '../hooks/useSelectorManager';
import { useSelectionMode } from '../hooks/useSelectionMode';
import { SelectorState } from '../../shared/types/extraction';
import { WizardLayout } from '../components/wizard/WizardLayout';
import { Step1Selection } from '../components/summarizer/wizard/Step1Selection';
import { Step2SummaryChat } from '../components/summarizer/wizard/Step2SummaryChat';

interface TextSummarizerPageProps {
    onBack?: () => void;
}

export default function TextSummarizerPage({ onBack }: TextSummarizerPageProps) {
    const {
        selectors,
        addSelector,
        removeSelector,
        updateSelector,
        clearSelectors
    } = useSelectorManager();

    const {
        status: selectionStatus,
        setStatus: setSelectionStatus,
        startSelection,
        stopSelection,
    } = useSelectionMode();

    const [step, setStep] = useState(1);
    const [selectedText, setSelectedText] = useState<string>('');

    // Listener for element selection
    useEffect(() => {
        const messageListener = async (message: any, sender: chrome.runtime.MessageSender) => {
            if (message.type === 'ELEMENT_SELECTED') {
                const payload = message.payload as SelectorState;

                if (payload.success) {
                    // Start fresh with a single selector for summarization
                    clearSelectors();
                    addSelector({
                        id: Date.now().toString(),
                        containerSelector: payload.containerSelector,
                        containerSelectors: payload.containerSelectors,
                        containerXPath: payload.containerXPath,
                        itemSelector: payload.itemSelector,
                        itemSelectors: payload.itemSelectors,
                        itemXPath: payload.itemXPath,
                        count: payload.count || 1,
                        data: payload.data,
                        patternFound: payload.patternFound || false,
                        selectionMode: 'detail', // Note: use 'detail' mode for single element instead of 'list'
                        sourceTabId: sender.tab?.id
                    });

                    // Extract text preview from the first item
                    let text = '';
                    if (payload.data?.items?.[0]) {
                        text = Object.values(payload.data.items[0])
                            .map(v => typeof v === 'string' ? v : JSON.stringify(v))
                            .join('\n');
                    }
                    setSelectedText(text);

                    setSelectionStatus('ready');
                } else {
                    setSelectionStatus('idle');
                }
            } else if (message.type === 'PICKER_CANCELLED') {
                if (selectors.length === 0) setSelectionStatus('idle');
                else setSelectionStatus('ready');
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);
        return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, [addSelector, clearSelectors, selectors.length, setSelectionStatus]);

    const handleVerifySelector = async (selector: string) => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: 'TEST_SELECTOR',
                payload: { selector }
            });
        }
    };

    const handleNext = () => {
        setStep(2);
    };

    const renderStep = () => {
        switch (step) {
            case 1:
                return (
                    <Step1Selection
                        selectors={selectors}
                        selectionStatus={selectionStatus}
                        onStartSelection={() => startSelection('detail')}
                        onRemoveSelector={removeSelector}
                        onUpdateSelector={updateSelector}
                        onTestSelector={handleVerifySelector}
                        onNext={handleNext}
                        onCancel={stopSelection}
                    />
                );
            case 2:
                // If there's no data.items for some reason, provide fallback empty
                return (
                    <Step2SummaryChat
                        selectedText={selectedText}
                        onBack={() => setStep(1)}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <WizardLayout
            title="Text Summarizer"
            subtitle={step === 1 ? "Select the content you want to summarize" : "Summary and Chat"}
            currentStep={step}
            totalSteps={2}
            onBack={step === 1 ? onBack : () => setStep(1)}
        >
            {renderStep()}
        </WizardLayout>
    );
}
