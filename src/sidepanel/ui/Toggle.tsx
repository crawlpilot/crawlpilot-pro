import { useId, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cx } from './cx';

interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: ReactNode;
    /** A second line under the label. */
    hint?: ReactNode;
    disabled?: boolean;
    className?: string;
    id?: string;
    'aria-label'?: string;
}

function Labelled({ id, label, hint, disabled, className, control, end }: { id: string; label?: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string; control: ReactNode; end?: boolean }) {
    if (!label) return <span className={className}>{control}</span>;
    return (
        <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-2.5', end && 'flex-row-reverse justify-between', disabled && 'cursor-not-allowed opacity-50', className)}>
            <span className="flex shrink-0 pt-px">{control}</span>
            <span className="flex min-w-0 flex-col">
                <span className="text-body font-medium text-ink">{label}</span>
                {hint && <span className="text-caption text-ink-3">{hint}</span>}
            </span>
        </label>
    );
}

/** On or off, for a setting that applies at once. The label sits to the left, the switch to the right. */
export function Switch({ checked, onChange, label, hint, disabled, className, id, ...aria }: ToggleProps) {
    const auto = useId();
    const fid = id ?? auto;
    const control = (
        <span className="relative inline-flex">
            <input id={fid} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
                className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label={aria['aria-label']} />
            <span className={cx('flex h-[22px] w-[38px] items-center rounded-full border-[1.5px] p-[2px] transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--cp-ring)]',
                checked ? 'border-line-strong bg-brand' : 'border-ink/25 bg-ink/10')}>
                <span className={cx('size-[15px] rounded-full transition-transform duration-150', checked ? 'translate-x-4 bg-on-brand' : 'bg-surface shadow-sm')} />
            </span>
        </span>
    );
    return <Labelled id={fid} label={label} hint={hint} disabled={disabled} className={className} control={control} end />;
}

/** A tick box, for choosing items or opting in. `indeterminate` shows a dash (some of a group). */
export function Checkbox({ checked, onChange, label, hint, disabled, className, id, indeterminate, ...aria }: ToggleProps & { indeterminate?: boolean }) {
    const auto = useId();
    const fid = id ?? auto;
    const on = checked || indeterminate;
    const control = (
        <span className="relative inline-flex">
            <input id={fid} type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
                ref={el => { if (el) el.indeterminate = !!indeterminate; }}
                className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label={aria['aria-label']} />
            <span className={cx('flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors duration-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--cp-ring)]',
                on ? 'border-line-strong bg-brand text-on-brand' : 'border-ink/30 bg-surface')}>
                {indeterminate ? <Minus size={12} strokeWidth={3.5} /> : checked && <Check size={12} strokeWidth={3.5} />}
            </span>
        </span>
    );
    return <Labelled id={fid} label={label} hint={hint} disabled={disabled} className={className} control={control} />;
}

/** One of a few, each with its own line: use inside a `role="radiogroup"` or a fieldset. */
export function Radio({ checked, onChange, label, hint, disabled, className, id, name }: ToggleProps & { name?: string }) {
    const auto = useId();
    const fid = id ?? auto;
    const control = (
        <span className="relative inline-flex">
            <input id={fid} type="radio" name={name} checked={checked} disabled={disabled} onChange={e => e.target.checked && onChange(true)}
                className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0" />
            <span className={cx('flex size-[18px] items-center justify-center rounded-full border-[1.5px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--cp-ring)]',
                checked ? 'border-line-strong bg-brand' : 'border-ink/30 bg-surface')}>
                {checked && <span className="size-2 rounded-full bg-on-brand" />}
            </span>
        </span>
    );
    return <Labelled id={fid} label={label} hint={hint} disabled={disabled} className={className} control={control} />;
}
