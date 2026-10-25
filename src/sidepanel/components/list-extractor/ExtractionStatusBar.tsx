import { Play, X, Database, Layers } from 'lucide-react';
import { ExtractionStatus } from '../../../shared/types/extraction';
import { Button, Progress, Spinner, Text } from '../../ui';

interface ExtractionStatusBarProps {
    status: ExtractionStatus;
    hasSelectors: boolean;
    selectorCount: number;
    onStart: () => void;
    onStop: (force?: boolean) => void;
    showStartButton?: boolean;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    return (
        <div className="flex flex-1 flex-col gap-0.5 rounded-2xl bg-surface-2 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-caption font-medium text-ink-2 [&_svg]:size-3">{icon}{label}</span>
            <span className="font-display text-title font-extrabold tracking-[-0.03em] text-ink tabular-nums">{value}</span>
        </div>
    );
}

export function ExtractionStatusBar({ status, hasSelectors, selectorCount, onStart, onStop, showStartButton = true }: ExtractionStatusBarProps) {
    return (
        <div className="absolute inset-x-4 bottom-6 z-[100]">
            {status.isExtracting ? (
                <div className="flex flex-col gap-4 rounded-sheet border-[1.5px] border-line-strong bg-surface p-4 shadow-press animate-pop">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand text-on-brand">
                                <Spinner size={18} />
                            </span>
                            <div className="min-w-0">
                                <Text weight="bold">Getting your data</Text>
                                <Text size="caption" tone="muted">Reading the page and collecting items…</Text>
                            </div>
                        </div>
                        <Button size="sm" variant="danger" icon={<X />} title="Shift+click to force stop" onClick={e => onStop(e.shiftKey)}>Stop</Button>
                    </div>

                    <div className="flex gap-2">
                        <Stat icon={<Database />} label="Items found" value={status.totalProcessed} />
                        <Stat icon={<Layers />} label="Page" value={status.currentPage || 1} />
                    </div>
                    {!!status.duplicates && (
                        <Text size="caption" tone="muted" className="-mt-2">
                            {status.duplicates} duplicate row{status.duplicates !== 1 ? 's' : ''} from earlier pages skipped
                        </Text>
                    )}
                    <Progress label="Getting your data" />
                </div>
            ) : showStartButton ? (
                <Button variant="primary" size="lg" fullWidth onClick={onStart} disabled={!hasSelectors} icon={<Play fill="currentColor" />}>
                    Run extraction · {selectorCount} {selectorCount === 1 ? 'field' : 'fields'}
                </Button>
            ) : null}
        </div>
    );
}
