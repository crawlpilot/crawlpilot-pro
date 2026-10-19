import { Segmented } from '../../ui';
import type { SummaryType, SummaryLength } from '@/shared/types/summarizer';

const TYPE_OPTIONS: { value: SummaryType; label: string }[] = [
    { value: 'key-points', label: 'Key points' },
    { value: 'tldr', label: 'TL;DR' },
    { value: 'teaser', label: 'Teaser' },
    { value: 'headline', label: 'Headline' }
];

const LENGTH_OPTIONS: { value: SummaryLength; label: string }[] = [
    { value: 'short', label: 'S' },
    { value: 'medium', label: 'M' },
    { value: 'long', label: 'L' }
];

interface SummaryControlsProps {
    type: SummaryType;
    length: SummaryLength;
    disabled: boolean;
    onChange(type: SummaryType, length: SummaryLength): void;
}

export function SummaryControls({ type, length, disabled, onChange }: SummaryControlsProps) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" aria-label="Summary type" value={type} onChange={v => onChange(v, length)}
                options={TYPE_OPTIONS.map(o => ({ ...o, disabled }))} />
            <Segmented size="sm" aria-label="Summary length" value={length} onChange={v => onChange(type, v)}
                options={LENGTH_OPTIONS.map(o => ({ ...o, disabled }))} />
        </div>
    );
}
