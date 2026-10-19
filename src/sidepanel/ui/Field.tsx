import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

/** The box every text control shares, so inputs, text areas and selects look alike. */
export const FIELD_BOX = 'flex w-full items-center gap-2 rounded-field border-[1.5px] border-line bg-surface text-ink transition-[border-color,box-shadow] duration-150 '
    + 'hover:border-ink/30 focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_rgb(var(--cp-brand-rgb)/0.45)]';

const FIELD_SIZES = { sm: 'min-h-8 px-2.5 text-small', md: 'min-h-10 px-3 text-body' };

interface FieldFrameProps {
    id: string;
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    className?: string;
    children: ReactNode;
}

/** Label above, hint or error below. */
export function FieldFrame({ id, label, hint, error, className, children }: FieldFrameProps) {
    return (
        <div className={cx('flex min-w-0 flex-col gap-1', className)}>
            {label && <label htmlFor={id} className="text-small font-semibold text-ink">{label}</label>}
            {children}
            {(error || hint) && (
                <span id={`${id}-hint`} className={cx('text-caption', error ? 'text-danger' : 'text-ink-3')}>{error || hint}</span>
            )}
        </div>
    );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label?: ReactNode;
    hint?: ReactNode;
    /** A message turns the field red and replaces the hint; `true` only turns it red. */
    error?: ReactNode;
    size?: 'sm' | 'md';
    /** An icon or text inside the box before the value. */
    start?: ReactNode;
    /** A button or text inside the box after the value. */
    end?: ReactNode;
    /** Classes for the outer wrapper (width, margins). */
    className?: string;
    inputClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
    { label, hint, error, size = 'md', start, end, className, inputClassName, id, disabled, ...rest }, ref,
) {
    const auto = useId();
    const fid = id ?? auto;
    return (
        <FieldFrame id={fid} label={label} hint={hint} error={typeof error === 'boolean' ? undefined : error} className={className}>
            <div className={cx(FIELD_BOX, FIELD_SIZES[size], !!error && 'border-danger!', disabled && 'opacity-55')}>
                {start && <span className="flex shrink-0 text-ink-3 [&_svg]:size-4">{start}</span>}
                <input ref={ref} id={fid} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={error || hint ? `${fid}-hint` : undefined}
                    className={cx('min-w-0 flex-1 self-stretch border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-ink-3 focus-visible:outline-none', inputClassName)} {...rest} />
                {end && <span className="flex shrink-0 items-center text-ink-3">{end}</span>}
            </div>
        </FieldFrame>
    );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    mono?: boolean;
    className?: string;
    inputClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
    { label, hint, error, mono, className, inputClassName, id, rows = 3, ...rest }, ref,
) {
    const auto = useId();
    const fid = id ?? auto;
    return (
        <FieldFrame id={fid} label={label} hint={hint} error={typeof error === 'boolean' ? undefined : error} className={className}>
            <div className={cx(FIELD_BOX, 'px-3 py-2 text-body', !!error && 'border-danger!')}>
                <textarea ref={ref} id={fid} rows={rows} aria-invalid={!!error || undefined}
                    className={cx('min-w-0 flex-1 resize-y border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-ink-3 focus-visible:outline-none', mono && 'font-mono text-small', inputClassName)} {...rest} />
            </div>
        </FieldFrame>
    );
});
