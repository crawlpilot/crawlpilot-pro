import { ReactNode, useEffect, useState } from 'react';
import { MousePointer2, Plus } from 'lucide-react';
import { Button, Card, Heading, Row, Stack, Text } from '../../../ui';
import { useTranslation } from 'react-i18next';
import { SelectorCard } from '../SelectorCard';
import { ListPick } from '../../../../shared/types/extraction';

const HINT_KEY = 'crawlpilot_list_hint_seen';

interface Step1SelectionProps {
    selectors: ListPick[];
    selectionStatus?: 'idle' | 'selecting' | 'ready';
    selectingFor: string | null;
    onStartSelection: () => void;
    onRemoveSelector: (id: string) => void;
    onUpdateSelector: (id: string, updates: Partial<ListPick>) => void;
    onTestSelector: (selector: string) => void;
    onNext: () => void;
    onCancel?: () => void;
    /** The one-click run card, shown once a list is picked. */
    quickRun?: ReactNode;
}

export function Step1Selection({
    selectors,
    selectionStatus = 'idle',
    selectingFor,
    onStartSelection,
    onRemoveSelector,
    onUpdateSelector,
    onTestSelector,
    onNext,
    onCancel,
    quickRun
}: Step1SelectionProps) {

    const { t } = useTranslation('listExtractor');
    const hasSelection = selectors.length > 0;
    const [showHint, setShowHint] = useState(() => !localStorage.getItem(HINT_KEY));

    useEffect(() => {
        if (hasSelection && showHint) {
            localStorage.setItem(HINT_KEY, '1');
            setShowHint(false);
        }
    }, [hasSelection, showHint]);

    return (
        <Stack gap={4}>
            {!hasSelection && selectionStatus !== 'selecting' && (
                <Card pad="lg" className="text-center">
                    <div className="mx-auto mb-5 flex size-16 -rotate-6 items-center justify-center rounded-[20px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press">
                        <MousePointer2 size={28} />
                    </div>
                    <Heading size="heading" className="mb-1">{t('step1.pickRepeatingItem')}</Heading>
                    <Text size="small" tone="muted" className="mx-auto mb-5 max-w-[280px]">{t('step1.pickDescription')}</Text>
                    <Button variant="primary" size="lg" onClick={onStartSelection} icon={<MousePointer2 />}>{t('step1.selectOnPage')}</Button>
                    {showHint && (
                        <div className="mt-5 rounded-2xl border-[1.5px] border-dashed border-line bg-surface-2 p-3 animate-fade-in">
                            <Text size="caption" tone="muted">{t('step1.hint')}</Text>
                        </div>
                    )}
                </Card>
            )}

            {selectionStatus === 'selecting' && selectingFor === 'list' && <Listening title={t('step1.listeningForClick')} hint={t('step1.clickAnyRepeating')} cancel={t('step1.pressEscToCancel')} onCancel={onCancel} />}

            {hasSelection && (
                <Stack gap={3}>
                    {quickRun}
                    <Row justify="between">
                        <Text size="small" tone="muted" weight="semibold">{t('step1.fieldsSelected', { count: selectors.length })}</Text>
                        <Button size="sm" variant="ghost" icon={<Plus />} onClick={onStartSelection} disabled={selectionStatus === 'selecting'}>
                            {t('step1.addAnotherField')}
                        </Button>
                    </Row>

                    <Stack gap={3}>
                        {selectors.map((selector) => (
                            <SelectorCard
                                key={selector.id}
                                selector={selector}
                                onRemove={() => onRemoveSelector(selector.id)}
                                onUpdate={onUpdateSelector}
                                onTest={onTestSelector}
                            />
                        ))}
                    </Stack>

                    <div className="flex justify-end border-t border-line pt-3">
                        <Button variant={quickRun ? 'ghost' : 'primary'} onClick={onNext} disabled={selectionStatus === 'selecting'}>
                            {t('step1.configurePagination')}
                        </Button>
                    </div>
                </Stack>
            )}
        </Stack>
    );
}

/** Waiting for a click on the page: a dashed box that pulses, and how to stop. */
export function Listening({ title, hint, cancel, onCancel }: { title: string; hint?: string; cancel: string; onCancel?: () => void }) {
    return (
        <div className="rounded-card border-2 border-dashed border-line-strong bg-brand/15 p-6 text-center">
            <div className="mb-3 flex justify-center text-ink"><MousePointer2 size={36} className="animate-pulse" /></div>
            <Text weight="semibold">{title}</Text>
            {hint && <Text size="small" tone="muted" className="mt-0.5">{hint}</Text>}
            <Button variant="ghost" size="sm" onClick={onCancel} className="mt-3 underline">{cancel}</Button>
        </div>
    );
}
