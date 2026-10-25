/**
 * This page as markdown (docs/plans/automation-and-page-tools-plan.md §3.7): the metadata extractor's
 * reading of the page (closed sections already in the page read too, nothing clicked), with front
 * matter, to copy or download.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, FileText, RefreshCw } from 'lucide-react';
import { Button, Card, IconButton, Notice, Segmented, Skeleton, Stack, Switch, Text, TextArea } from '../ui';
import ToolHeader from '../components/ui/ToolHeader';
import { sendToTab } from '../../shared/messages';
import { usePageTab } from '../hooks/usePageTab';
import { pageMarkdown, type MarkdownPage as Page } from '../../shared/export/markdownExport';
import { downloadText } from '../services/download';
import { slug } from '../../shared/utils/text';
import type { MetadataExtractOptions, MetadataExtractResult } from '../../shared/types/metadata';

type Scope = 'main' | 'pruned' | 'whole';

export default function MarkdownPage({ onBack }: { onBack: () => void }) {
    const { t } = useTranslation('pageMarkdown');
    const page = usePageTab();
    const tabId = page.tab?.id;
    const [scope, setScope] = useState<Scope>('main');
    const [links, setLinks] = useState(true);
    const [images, setImages] = useState(false);
    const [reveal, setReveal] = useState(true);
    const [front, setFront] = useState(true);
    const [result, setResult] = useState<MetadataExtractResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [copied, setCopied] = useState(false);

    const read = useCallback(async () => {
        if (!tabId || !page.web) return;
        setBusy(true);
        setError(false);
        const options: MetadataExtractOptions = {
            url: page.url, includeLinks: links, includeImages: images, includeTables: true,
            favorPrecision: scope === 'pruned', favorRecall: scope === 'whole', reveal: reveal ? 'read' : 'off',
        };
        try {
            const reply = await sendToTab(tabId, 'CMD_EXTRACT_METADATA', { url: page.url, options });
            if (!reply.success) throw new Error(reply.error);
            setResult(reply.result);
        } catch {
            setError(true);
            setResult(null);
        } finally {
            setBusy(false);
        }
    }, [tabId, page.url, page.web, scope, links, images, reveal]);

    useEffect(() => { void read(); }, [read]);

    const meta = result?.metadata;
    const doc: Page | null = result ? {
        url: meta?.canonicalUrl || page.url, title: meta?.title || page.title, description: meta?.description,
        author: meta?.author, published: meta?.publishedDate, lang: result.language ?? meta?.language,
        fetchedAt: new Date().toISOString(), markdown: result.markdown,
    } : null;
    const text = doc ? pageMarkdown(doc, front) : '';
    const words = result ? result.markdown.split(/\s+/).filter(Boolean).length : 0;

    const copy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={t('title')} subtitle={t('subtitle')} icon={<FileText size={17} />} onBack={onBack} loading={busy}
                actions={<IconButton label={t('refresh')} variant="ghost" size="sm" onClick={() => void read()}><RefreshCw /></IconButton>} />
            <div className="flex-1 overflow-y-auto p-4">
                <Stack gap={3}>
                    {!page.web && <Notice tone="info">{t('notWeb')}</Notice>}
                    <Segmented fullWidth value={scope} onChange={setScope} aria-label={t('scope.label')} options={[
                        { value: 'main', label: t('scope.main') },
                        { value: 'pruned', label: t('scope.pruned') },
                        { value: 'whole', label: t('scope.whole') },
                    ]} />
                    <Card pad="sm">
                        <Stack gap={2}>
                            <Switch checked={reveal} onChange={setReveal} label={t('reveal')} hint={t('revealHint')} />
                            <Switch checked={links} onChange={setLinks} label={t('links')} />
                            <Switch checked={images} onChange={setImages} label={t('images')} />
                            <Switch checked={front} onChange={setFront} label={t('front')} hint={t('frontHint')} />
                        </Stack>
                    </Card>

                    {error && <Notice tone="warning">{t('error')}</Notice>}
                    {busy && !result && <Skeleton className="h-64" />}
                    {result && (
                        <>
                            <Text size="caption" tone="muted" data-testid="markdown-stats">
                                {t('stats', { words: words.toLocaleString(), tokens: Math.ceil(text.length / 4).toLocaleString() })}
                                {result.revealed ? ` · ${t('opened', { sections: result.revealed })}` : ''}
                            </Text>
                            <TextArea mono readOnly rows={16} value={text} aria-label={t('preview')} data-testid="markdown-text" />
                            <div className="flex flex-wrap gap-1.5">
                                <Button variant="primary" onClick={() => void copy()} icon={copied ? <Check /> : <Copy />}>{copied ? t('copied') : t('copy')}</Button>
                                <Button onClick={() => downloadText(text, `${slug((doc?.title || page.host || 'page').slice(0, 60), '-', 'page')}.md`, 'text/markdown')} icon={<Download />}>{t('download')}</Button>
                            </div>
                            <Text size="caption" tone="faint">{t('manyHint')}</Text>
                        </>
                    )}
                </Stack>
            </div>
        </div>
    );
}
