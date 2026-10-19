import { ReactNode } from 'react';
import { Box } from '@mui/material';
import ToolHeader from '../ui/ToolHeader';

interface WizardLayoutProps {
    title: string;
    subtitle?: string;
    currentStep: number;
    totalSteps: number;
    /** The steps' names, shown in the header; numbers only when absent. */
    stepLabels?: string[];
    onBack?: () => void;
    isLoading?: boolean;
    children: ReactNode;
}

/** A guided tool: the shared header with its named steps, then the current step's content. */
export function WizardLayout({ title, subtitle, currentStep, totalSteps, stepLabels, onBack, isLoading = false, children }: WizardLayoutProps) {
    const labels = stepLabels ?? Array.from({ length: totalSteps }, (_, i) => `Step ${i + 1}`);
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <ToolHeader title={title} subtitle={subtitle} onBack={onBack} loading={isLoading}
                steps={totalSteps > 1 ? { labels, current: currentStep } : undefined} />
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                <div className="animate-fade-in-up">{children}</div>
            </Box>
        </Box>
    );
}
