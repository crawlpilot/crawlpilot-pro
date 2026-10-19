import { useState } from 'react';
import { AlertCircle, Globe } from 'lucide-react';
import type { PageTab } from '../../hooks/usePageTab';
import { Tooltip } from '../../ui';

/** The page the tools are working on: its icon, title and host, or why there is none. */
export default function PageStrip({ page, message }: { page: PageTab; message?: string }) {
    const [broken, setBroken] = useState(false);
    if (!page.web) {
        return (
            <div className="flex items-center gap-2 rounded-2xl bg-danger-soft px-3 py-2">
                <AlertCircle size={15} className="shrink-0 text-danger" />
                <span className="text-small text-ink">{message ?? 'Open a web page (http or https) to use CrawlPilot on it.'}</span>
            </div>
        );
    }
    return (
        <Tooltip title={page.url} placement="bottom">
            <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2">
                {page.favIconUrl && !broken
                    ? <img src={page.favIconUrl} alt="" className="size-4 shrink-0 rounded" onError={() => setBroken(true)} />
                    : <Globe size={15} className="shrink-0 text-ink-2" />}
                <div className="min-w-0 flex-1">
                    <div className="truncate text-small font-semibold leading-tight text-ink">{page.title || page.host}</div>
                    <div className="truncate text-[11px] leading-tight text-ink-3">{page.host}</div>
                </div>
                <span className="relative flex size-2 shrink-0" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
                    <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
            </div>
        </Tooltip>
    );
}
