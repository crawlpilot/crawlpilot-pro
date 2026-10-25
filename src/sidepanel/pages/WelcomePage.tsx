import { ArrowRight, List, MousePointerClick, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, Text } from '../ui';

interface WelcomePageProps {
    onNavigate: (view: string) => void;
}

export default function WelcomePage({ onNavigate }: WelcomePageProps) {
    const { t } = useTranslation('welcome');
    return (
        <div className="flex min-h-full flex-col items-center justify-center p-6 animate-slide-up">
            <div className="mb-5 flex size-16 -rotate-6 items-center justify-center rounded-[20px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press">
                <Sparkles className="size-7" />
            </div>
            <Heading size="title" className="mb-2 text-center">{t('title')}</Heading>
            <Text tone="muted" className="mb-7 max-w-xs text-center">{t('description')}</Text>

            <div className="mb-7 flex w-full max-w-xs flex-col gap-2.5">
                <Card tone="lilac" pad="sm" className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-ink"><List size={16} /></span>
                    <div>
                        <Text size="small" weight="semibold">{t('listExtractor.title')}</Text>
                        <Text size="caption" tone="muted">{t('listExtractor.description')}</Text>
                    </div>
                </Card>
                <Card tone="mint" pad="sm" className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-ink"><MousePointerClick size={16} /></span>
                    <div>
                        <Text size="small" weight="semibold">{t('pageExtractor.title')}</Text>
                        <Text size="caption" tone="muted">{t('pageExtractor.description')}</Text>
                    </div>
                </Card>
            </div>

            <Button variant="primary" size="lg" fullWidth className="mb-2 max-w-xs" iconEnd={<ArrowRight />} onClick={() => onNavigate('list-extractor')}>
                {t('tryFirstScrape')}
            </Button>
            <Button variant="ghost" fullWidth className="max-w-xs" onClick={() => onNavigate('home')}>{t('goHome')}</Button>
        </div>
    );
}
