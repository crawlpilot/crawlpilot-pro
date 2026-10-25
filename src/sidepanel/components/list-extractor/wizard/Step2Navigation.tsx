import { MousePointer2, ArrowRight } from 'lucide-react';
import { Button, CardButton, Heading, Stack, Text, cx } from '../../../ui';
import { Listening } from './Step1Selection';
import { PaginationMode } from '../../../../shared/types/extraction';
import { NextButtonCard } from '../NextButtonCard';
import { SelectorEditDialog } from '../../shared/SelectorEditDialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Step2NavigationProps {
    paginationMode: PaginationMode;
    setPaginationMode: (mode: PaginationMode) => void;
    /** The Next / Load more control's chain (empty until picked). */
    next: string[];
    selectingFor: string | null;
    onStartSelection: (type: 'nextButton') => void;
    onRemoveNextButton: () => void;
    onUpdateNextButton: (chain: string[]) => void;
    onTestSelector: (selector: string) => void;
    onNext: () => void;
    onBack: () => void;
    onCancel?: () => void;
}

export function Step2Navigation({
    paginationMode,
    setPaginationMode,
    next,
    selectingFor,
    onStartSelection,
    onRemoveNextButton,
    onUpdateNextButton,
    onTestSelector,
    onNext,
    onBack,
    onCancel
}: Step2NavigationProps) {
    const { t } = useTranslation('listExtractor');

    const [isEditing, setIsEditing] = useState(false);

    // Helper to check if we are good to go
    const isReady = paginationMode === 'auto' || next.length > 0;

    const handleSaveSelectors = (chain: string[]) => {
        onUpdateNextButton(chain);
        setIsEditing(false);
    };

    const StrategyOption = ({ mode, title, description }: { mode: PaginationMode; title: string; description: string }) => {
        const on = paginationMode === mode;
        return (
            <CardButton pad="sm" role="radio" aria-checked={on} onClick={() => setPaginationMode(mode)}
                className={cx('flex items-start gap-3', on && 'border-[1.5px]! border-line-strong! bg-brand/15! shadow-press')}>
                <span className={cx('mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]', on ? 'border-line-strong bg-brand' : 'border-ink/30')}>
                    {on && <span className="size-2 rounded-full bg-on-brand" />}
                </span>
                <span className="min-w-0">
                    <Text weight="semibold">{title}</Text>
                    <Text size="caption" tone="muted" className="mt-0.5">{description}</Text>
                </span>
            </CardButton>
        );
    };

    return (
        <Stack gap={4} className="animate-fade-in">
            <div>
                <Heading size="heading">{t('step2.howToLoadMore')}</Heading>
                <Text size="small" tone="muted" className="mt-0.5">{t('step2.pickNavigationMethod')}</Text>
            </div>

            <Stack gap={2} role="radiogroup" aria-label={t('step2.howToLoadMore')}>
                {StrategyOption({ mode: 'pagination', title: t('step2.numberedPagination.title'), description: t('step2.numberedPagination.description') })}
                {StrategyOption({ mode: 'loadMore', title: t('step2.loadMoreButton.title'), description: t('step2.loadMoreButton.description') })}
                {StrategyOption({ mode: 'auto', title: t('step2.infiniteScroll.title'), description: t('step2.infiniteScroll.description') })}
            </Stack>

            {(paginationMode === 'pagination' || paginationMode === 'loadMore') && (
                <div className="border-t border-line pt-4 animate-slide-up">
                    <Text weight="semibold" className="mb-3">
                        {paginationMode === 'loadMore' ? t('step2.pointToLoadMore') : t('step2.pointToNext')}
                    </Text>

                    {selectingFor === 'nextButton' ? (
                        <Listening title={t('step2.clickTheButton')} cancel={t('step2.pressEscToCancel')} onCancel={onCancel} />
                    ) : next.length > 0 ? (
                        <NextButtonCard
                            chain={next}
                            title={paginationMode === 'loadMore' ? t('step2.loadMoreButtonLabel') : t('step2.nextButton')}
                            onRemove={onRemoveNextButton}
                            onTest={onTestSelector}
                            onEdit={() => setIsEditing(true)}
                        />
                    ) : (
                        <Button fullWidth size="lg" icon={<MousePointer2 />} onClick={() => onStartSelection('nextButton')} className="border-dashed">
                            {t('step2.pickNavigationButton')}
                        </Button>
                    )}
                </div>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
                <Button variant="ghost" onClick={onBack}>{t('step2.back')}</Button>
                <Button variant="primary" onClick={onNext} disabled={!isReady} iconEnd={<ArrowRight />}>{t('step2.reviewAndRun')}</Button>
            </div>

            <SelectorEditDialog
                isOpen={isEditing}
                title="Edit Navigation Selectors"
                selectors={next}
                onSave={handleSaveSelectors}
                onCancel={() => setIsEditing(false)}
                onVerify={async (s) => onTestSelector(s)}
            />
        </Stack>
    );
}
