import { ReactNode } from 'react';
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
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={title} subtitle={subtitle} onBack={onBack} loading={isLoading}
                steps={totalSteps > 1 ? { labels, current: currentStep } : undefined} />
            <div className="flex-1 overflow-y-auto p-4">
                <div className="animate-slide-up">{children}</div>
            </div>
        </div>
    );
}
