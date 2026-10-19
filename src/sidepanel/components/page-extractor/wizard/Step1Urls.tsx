import { useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Compass, Database, FileText, Upload, X } from 'lucide-react';
import { pageTabId } from '../../../hooks/usePageTab';
import { Button, Card, CardButton, Chip, Disclosure, Heading, IconButton, Stack, Text, type Tone } from '../../../ui';
import SiteDiscoveryDialog from '../SiteDiscoveryDialog';

interface Step1UrlsProps {
    selectedUrls: string[];
    setSelectedUrls: (urls: string[]) => void;
    setShowDataSourceSelector: (show: boolean) => void;
    handleRemoveUrl: (index: number) => void;
    onNext: () => void;
}

export function Step1Urls({
    selectedUrls,
    setSelectedUrls,
    setShowDataSourceSelector,
    handleRemoveUrl,
    onNext
}: Step1UrlsProps) {
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [discoverOpen, setDiscoverOpen] = useState(false);

    const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const lines = text.split(/\r?\n/);
            const newUrls: string[] = [];
            for (const line of lines) {
                // Support comma or tab separated — take the first column
                const parts = line.split(/[,\t]/);
                for (const part of parts) {
                    const url = part.trim().replace(/^"|"$/g, '');
                    if (url.startsWith('http://') || url.startsWith('https://')) {
                        newUrls.push(url);
                    }
                }
            }
            // Deduplicate and merge with existing
            const merged = Array.from(new Set([...selectedUrls, ...newUrls]));
            setSelectedUrls(merged);
        };
        reader.readAsText(file);
        // Reset so same file can be re-uploaded if needed
        e.target.value = '';
    };
    const addThisPage = async () => {
        const id = await pageTabId();
        const url = id ? (await chrome.tabs.get(id)).url : undefined;
        if (url && /^https?:/.test(url)) setSelectedUrls(Array.from(new Set([...selectedUrls, url])));
    };

    const source = (tone: Tone, icon: React.ReactNode, title: string, hint: string, onClick: () => void) => (
        <CardButton tone={tone} pad="sm" onClick={onClick} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-ink [&_svg]:size-[18px]">{icon}</span>
            <span className="min-w-0 flex-1">
                <Text weight="semibold">{title}</Text>
                <Text size="caption" tone="muted">{hint}</Text>
            </span>
            <ChevronRight size={16} className="shrink-0 text-ink-2" />
        </CardButton>
    );

    return (
        <Stack gap={4} className="animate-slide-up">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <Heading size="heading">Which pages?</Heading>
                    {selectedUrls.length === 0 && <Text size="small" tone="muted" className="mt-0.5">Choose where the page addresses come from</Text>}
                </div>
                {selectedUrls.length > 0 && <Chip tone="success" icon={<Check />}>{selectedUrls.length} loaded</Chip>}
            </div>

            {selectedUrls.length > 0 ? (
                <Card pad="none" className="overflow-hidden animate-fade-in">
                    <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                        <Text size="small" weight="semibold" className="flex items-center gap-1.5"><Database size={14} className="text-ink-2" /> URL list</Text>
                        <Button size="sm" variant="ghost" className="-mr-2 text-danger" onClick={() => setSelectedUrls([])}>Clear</Button>
                    </div>
                    <div className="max-h-[180px] overflow-y-auto">
                        {selectedUrls.map((url, idx) => (
                            <div key={idx} className="group flex items-center justify-between gap-2 border-b border-line px-3.5 py-1 last:border-0">
                                <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2" title={url}>{url}</span>
                                <IconButton size="sm" label="Remove" noTooltip className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => handleRemoveUrl(idx)}><X /></IconButton>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-line p-2">
                        <Button size="sm" variant="ghost" fullWidth icon={<Database />} onClick={() => setShowDataSourceSelector(true)}>Choose a different source</Button>
                    </div>
                </Card>
            ) : (
                <Stack gap={2}>
                    {source('mint', <FileText />, 'This page', 'The page open in this tab', addThisPage)}
                    {source('sky', <Upload />, 'Upload a file', 'A CSV with one page address per row', () => csvInputRef.current?.click())}
                    <input ref={csvInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleCsvUpload} />
                    <Disclosure variant="plain" summary="What the file should look like" className="px-1">
                        <div className="border-l-2 border-line pl-3 text-caption text-ink-2">
                            <p className="m-0">One URL per line, or comma-separated with a header row.</p>
                            <p className="m-0 font-mono">https://example.com/product/1</p>
                            <p className="m-0 font-mono">https://example.com/product/2</p>
                        </div>
                    </Disclosure>
                    {source('lilac', <Database />, 'A list you saved', 'The links in a table you already have', () => setShowDataSourceSelector(true))}
                    {source('butter', <Compass />, 'Find pages on this site', 'From its sitemap, grouped by kind of page', () => setDiscoverOpen(true))}
                </Stack>
            )}

            <SiteDiscoveryDialog
                open={discoverOpen}
                onClose={() => setDiscoverOpen(false)}
                onUse={(urls) => setSelectedUrls(Array.from(new Set([...selectedUrls, ...urls])))}
            />

            <div className="flex justify-end border-t border-line pt-4">
                <Button variant="primary" onClick={onNext} disabled={selectedUrls.length === 0} iconEnd={selectedUrls.length ? <ArrowRight /> : undefined}>
                    {selectedUrls.length === 0 ? 'Add at least one page' : `Next: ${selectedUrls.length} page${selectedUrls.length === 1 ? '' : 's'}`}
                </Button>
            </div>
        </Stack>
    );
}
