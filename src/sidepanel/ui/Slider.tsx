import { useId, type ReactNode } from 'react';
import { cx } from './cx';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    label?: ReactNode;
    /** Shown on the right of the label: the value with its unit. */
    valueLabel?: ReactNode;
    disabled?: boolean;
    className?: string;
}

/** A number in a range, dragged. */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, valueLabel, disabled, className }: SliderProps) {
    const id = useId();
    const pct = ((value - min) / (max - min || 1)) * 100;
    return (
        <div className={cx('flex flex-col gap-1.5', disabled && 'opacity-50', className)}>
            {(label || valueLabel) && (
                <div className="flex items-baseline justify-between gap-2">
                    {label && <label htmlFor={id} className="text-small font-semibold text-ink">{label}</label>}
                    {valueLabel !== undefined && <span className="font-display text-small font-bold text-ink">{valueLabel}</span>}
                </div>
            )}
            <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
                onChange={e => onChange(Number(e.target.value))}
                style={{ background: `linear-gradient(to right, var(--cp-brand) ${pct}%, rgb(var(--cp-ink-rgb) / 0.1) ${pct}%)` }}
                className="cp-range h-2 w-full cursor-pointer appearance-none rounded-full border border-line disabled:cursor-not-allowed" />
        </div>
    );
}
