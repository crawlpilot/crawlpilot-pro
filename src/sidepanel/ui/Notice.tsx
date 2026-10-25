import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cx } from './cx';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<NoticeTone, { box: string; icon: string; Icon: typeof Info }> = {
    info: { box: 'bg-info-soft', icon: 'text-info', Icon: Info },
    success: { box: 'bg-success-soft', icon: 'text-success', Icon: CheckCircle2 },
    warning: { box: 'bg-warning-soft', icon: 'text-warning', Icon: AlertTriangle },
    danger: { box: 'bg-danger-soft', icon: 'text-danger', Icon: XCircle },
    neutral: { box: 'bg-ink/6', icon: 'text-ink-2', Icon: Info },
};

interface NoticeProps {
    tone?: NoticeTone;
    title?: ReactNode;
    /** Replaces the tone's icon; `false` shows none. */
    icon?: ReactNode | false;
    /** A button on the right or under the text. */
    action?: ReactNode;
    onClose?: () => void;
    className?: string;
    children?: ReactNode;
}

/** A message in the flow of the page: something went wrong, something to know, something done. */
export function Notice({ tone = 'info', title, icon, action, onClose, className, children }: NoticeProps) {
    const t = TONES[tone];
    return (
        <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
            className={cx('flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-small text-ink', t.box, className)}>
            {icon !== false && <span className={cx('mt-px flex shrink-0 [&_svg]:size-[17px]', t.icon)}>{icon ?? <t.Icon />}</span>}
            <div className="min-w-0 flex-1">
                {title && <div className="font-semibold text-ink">{title}</div>}
                {children && <div className={cx(title ? 'mt-0.5 text-ink-2' : 'text-ink')}>{children}</div>}
                {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
            </div>
            {onClose && (
                <button type="button" aria-label="Dismiss" onClick={onClose}
                    className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-ink/10">
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
