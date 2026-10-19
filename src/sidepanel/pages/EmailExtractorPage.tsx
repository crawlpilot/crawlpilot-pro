import { Check, Mail } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { Card, Chip, EmptyState, Text } from '../ui';

interface EmailExtractorPageProps {
    onBack: () => void;
}

const COMING = [
    'Find every email address on the page',
    'Collect them across many pages, following Next',
    'Drop duplicates and export as CSV',
    'Check the format and filter by domain',
];

export default function EmailExtractorPage({ onBack }: EmailExtractorPageProps) {
    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title="Email Extractor" subtitle="Find email addresses on pages" onBack={onBack} actions={<Chip tone="warning">Coming soon</Chip>} />
            <div className="flex-1 overflow-y-auto p-4">
                <EmptyState icon={<Mail />} title="On its way">We're building this one. Here's what it will do:</EmptyState>
                <Card tone="mint" className="flex flex-col gap-2.5">
                    {COMING.map(c => (
                        <div key={c} className="flex items-start gap-2">
                            <Check size={15} strokeWidth={3} className="mt-0.5 shrink-0 text-ink" />
                            <Text size="small">{c}</Text>
                        </div>
                    ))}
                </Card>
            </div>
        </div>
    );
}
