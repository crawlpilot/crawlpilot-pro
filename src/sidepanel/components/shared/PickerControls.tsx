/**
 * The side panel's mirror of the picker (docs/plans/picker-level-control-plan.md §3.5): the selection's
 * path, what a click saves, and buttons for Wider / Narrower / Prev / Next / Lock / Select / Deselect (start over:
 * the selection is dropped and the next one hovered is picked afresh). The page's
 * picker sends its state (`PICKER_STATE`); the buttons and the arrow keys here act on it.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { on, sendToActiveTab, type PickerState } from '../../../shared/messages';
import { Button, Text, ToggleChip } from '../../ui';

const act = (action: string) => { sendToActiveTab('PICKER_ACTION', { action }).catch(() => { /* picker not on this page */ }); };

/** Keys pressed in the side panel act on the page's picker. */
const KEYS: Record<string, string> = { ArrowUp: 'wider', ArrowDown: 'narrower', ArrowLeft: 'prev', ArrowRight: 'next', Enter: 'select', '[': 'wider', ']': 'narrower', Backspace: 'deselect', Delete: 'deselect' };

export function PickerControls({ onCancel }: { onCancel?: () => void }) {
    const [state, setState] = useState<PickerState | null>(null);

    useEffect(() => on('PICKER_STATE', s => setState(s)), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            const action = KEYS[e.key];
            if (!action) return;
            e.preventDefault();
            act(action);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <div className="overflow-hidden rounded-card border-2 border-dashed border-line-strong bg-brand/15" data-testid="picker-controls">
            {!state ? (
                <div className="p-5 text-center">
                    <Text weight="semibold">Hover over the page, then click to select</Text>
                    <Text size="caption" tone="muted">Then make it wider or narrower here, or with ↑ ↓ on the page.</Text>
                </div>
            ) : (
                <div className="flex flex-col gap-2.5 p-3.5">
                    {state.mode === 'path' && <div>
                        <Text size="caption" weight="semibold" tone="muted" className="mb-1">Selected</Text>
                        <div className="flex flex-wrap items-center gap-1">
                            {state.steps.slice(Math.max(0, state.index - 3)).map((label, i, shown) => {
                                const at = Math.max(0, state.index - 3) + i;
                                return (
                                    <span key={at} className="flex items-center gap-1">
                                        <button type="button" onClick={() => act(`step:${state.steps.length - 1 - at}`)}
                                            className={at === state.index
                                                ? 'cursor-pointer rounded-full bg-ink px-2 py-0.5 font-mono text-[11px] font-semibold text-bg'
                                                : 'cursor-pointer rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-ink/15'}>
                                            {label}
                                        </button>
                                        {i < shown.length - 1 && <span className="text-ink-3">›</span>}
                                    </span>
                                );
                            })}
                        </div>
                    </div>}
                    <div className={state.mode === 'path' ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-2 gap-1.5'}>
                        <Button size="sm" icon={<ArrowUp />} onClick={() => act('wider')} disabled={!state.canWider}>{state.mode === 'path' ? 'Wider' : 'Wider section'}</Button>
                        <Button size="sm" icon={<ArrowDown />} onClick={() => act('narrower')} disabled={!state.canNarrower}>{state.mode === 'path' ? 'Narrower' : 'Narrower section'}</Button>
                        {state.mode === 'path' && <>
                            <Button size="sm" icon={<ArrowLeft />} onClick={() => act('prev')} disabled={!state.canPrev} aria-label="Previous item">Prev</Button>
                            <Button size="sm" icon={<ArrowRight />} onClick={() => act('next')} disabled={!state.canNext} aria-label="Next item">Next</Button>
                        </>}
                    </div>
                    {state.readings.length > 0 && (
                        <div>
                            <Text size="caption" weight="semibold" tone="muted" className="mb-1">{state.mode === 'path' ? 'Save it as' : 'Section'}</Text>
                            <div className="flex flex-wrap gap-1">
                                {state.readings.map((label, i) => (
                                    <ToggleChip key={label} selected={i === state.reading} onClick={() => act(`reading:${i}`)}>{label}</ToggleChip>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Button size="sm" variant={state.locked ? 'secondary' : 'ghost'} icon={state.locked ? <Lock /> : <LockOpen />} onClick={() => act('lock')}>
                            {state.locked ? 'Locked' : 'Lock'}
                        </Button>
                        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => act('deselect')}
                            title="Drop this selection and point at something else on the page">Deselect</Button>
                        <Button size="sm" variant="primary" className="flex-1" icon={<Check />} onClick={() => act('select')}>Select</Button>
                    </div>
                    {!state.locked && <Text size="caption" tone="muted">Lock it to move the mouse here without losing the selection.</Text>}
                </div>
            )}
            <div className="border-t border-line px-4 py-2 text-center">
                <Button size="sm" variant="ghost" className="underline" onClick={onCancel}>Press Esc or click here to cancel</Button>
            </div>
        </div>
    );
}
