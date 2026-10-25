import { Minus, Plus } from 'lucide-react';

interface StepperProps {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    /** The accessible name of the group: what the number is. */
    label: string;
    /** Digits wide the value box is. */
    width?: number;
}

/** A number nudged with − and +: tabs at a time, a wait in milliseconds. */
export function Stepper({ value, onChange, min, max, step = 1, label, width = 4 }: StepperProps) {
    const btn = 'flex size-6 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-ink/8 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-3';
    return (
        <div className="inline-flex items-center gap-0.5 rounded-control bg-ink/6 p-0.5" role="group" aria-label={label}>
            <button type="button" aria-label={`Less ${label.toLowerCase()}`} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus /></button>
            <span className="text-center font-mono text-caption text-ink tabular-nums" style={{ width: `${width + 1}ch` }}>{value}</span>
            <button type="button" aria-label={`More ${label.toLowerCase()}`} className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus /></button>
        </div>
    );
}
