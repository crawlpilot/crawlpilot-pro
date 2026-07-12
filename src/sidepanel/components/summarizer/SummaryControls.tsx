import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
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
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <ToggleButtonGroup
                size="small"
                exclusive
                value={type}
                disabled={disabled}
                onChange={(_, value: SummaryType | null) => { if (value) onChange(value, length); }}
                sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.5, fontSize: '0.75rem', textTransform: 'none' } }}
            >
                {TYPE_OPTIONS.map(opt => (
                    <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
                ))}
            </ToggleButtonGroup>
            <ToggleButtonGroup
                size="small"
                exclusive
                value={length}
                disabled={disabled}
                onChange={(_, value: SummaryLength | null) => { if (value) onChange(type, value); }}
                sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.5, fontSize: '0.75rem', textTransform: 'none' } }}
            >
                {LENGTH_OPTIONS.map(opt => (
                    <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
                ))}
            </ToggleButtonGroup>
        </Stack>
    );
}
