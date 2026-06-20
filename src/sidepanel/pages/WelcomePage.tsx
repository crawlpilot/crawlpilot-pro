import { Database, List, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface WelcomePageProps {
    onNavigate: (view: string) => void;
}

export default function WelcomePage({ onNavigate }: WelcomePageProps) {
    const { t } = useTranslation('welcome');
    return (
        <div className="flex flex-col items-center justify-center min-h-full p-6 animate-fade-in-up">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <Database className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-2 text-center">{t('title')}</h1>
            <p className="text-sm text-text-muted text-center mb-8 max-w-xs leading-relaxed">
                {t('description')}
            </p>

            <div className="w-full max-w-xs space-y-3 mb-8">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-lighter border border-border-subtle">
                    <div className="w-8 h-8 rounded bg-accent-ai/10 flex items-center justify-center flex-shrink-0">
                        <List className="w-4 h-4 text-accent-ai" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-text-primary">{t('listExtractor.title')}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{t('listExtractor.description')}</p>
                    </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-lighter border border-border-subtle">
                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <MousePointerClick className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-text-primary">{t('pageExtractor.title')}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{t('pageExtractor.description')}</p>
                    </div>
                </div>
            </div>

            <button
                onClick={() => onNavigate('list-extractor')}
                className="btn btn-primary w-full max-w-xs h-11 text-sm mb-3"
            >
                {t('tryFirstScrape')}
            </button>
            <button
                onClick={() => onNavigate('home')}
                className="btn btn-ghost text-sm text-text-muted w-full max-w-xs"
            >
                {t('goHome')}
            </button>
        </div>
    );
}
