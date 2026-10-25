import { Database, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, Tooltip, cx } from '../../ui';

interface HeaderProps {
    onNavigate: (view: string) => void;
    activeView?: string;
    disabled?: boolean;
}

/**
 * The panel's header on Home: the brand, the user's saved data and settings, in one row. Tools
 * replace it with their own header (back, name, steps), so the panel never shows two navigations.
 */
export default function Header({ onNavigate, activeView, disabled }: HeaderProps) {
    const { t } = useTranslation('common');
    const go = (view: string) => { if (!disabled) onNavigate(view); };

    return (
        <header className={cx('flex shrink-0 items-center gap-1 border-b border-line bg-bg px-4 py-2.5 transition-opacity duration-300', disabled && 'pointer-events-none opacity-50')}>
            <button type="button" onClick={() => go('home')} aria-label={t('nav.home')}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                <img src={chrome.runtime.getURL('icons/icon32.png')} alt="" className="size-6" />
                <span className="font-display text-lead font-extrabold tracking-[-0.03em] text-ink">CrawlPilot Pro</span>
            </button>
            <Tooltip title={t('nav.myDataTooltip')}>
                <Button size="sm" variant="ghost" icon={<Database />} onClick={() => go('history')} className={cx(activeView === 'history' && 'text-ink')}>
                    {t('nav.myData')}
                </Button>
            </Tooltip>
            <IconButton label={t('nav.settings')} onClick={() => go('settings')}><Settings /></IconButton>
        </header>
    );
}
