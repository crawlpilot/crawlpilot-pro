/** Step 2 of "Same details from many pages": a ready-made set of details, or the user's own fields. */
import { ChevronRight, FileText, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CardButton, Heading, Stack, Text, type Tone } from '../../../ui';

function Choice({ icon, tone, title, hint, onClick }: { icon: React.ReactNode; tone: Tone; title: string; hint: string; onClick: () => void }) {
    return (
        <CardButton tone={tone} onClick={onClick} className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface/80 text-ink">{icon}</span>
            <span className="min-w-0 flex-1">
                <Text weight="bold">{title}</Text>
                <Text size="small" tone="muted">{hint}</Text>
            </span>
            <ChevronRight size={16} className="shrink-0 text-ink-2" />
        </CardButton>
    );
}

export function DetailsChoice({ pages, onArticle, onFields }: { pages: number; onArticle: () => void; onFields: () => void }) {
    const { t } = useTranslation('pageExtractor');
    return (
        <Stack gap={3}>
            <div>
                <Heading size="heading">{t('details.title')}</Heading>
                <Text size="small" tone="muted" className="mt-0.5">{t('details.subtitle', { count: pages })}</Text>
            </div>
            <Choice tone="sky" icon={<FileText size={20} />} title={t('details.article.title')} hint={t('details.article.hint')} onClick={onArticle} />
            <Choice tone="lilac" icon={<MousePointerClick size={20} />} title={t('details.fields.title')} hint={t('details.fields.hint')} onClick={onFields} />
        </Stack>
    );
}
