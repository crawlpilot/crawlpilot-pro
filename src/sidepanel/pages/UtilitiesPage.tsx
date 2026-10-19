import { useState } from 'react';
import { sendToTab } from '../../shared/messages';
import { Card, Chip, Collapse, Stack, Switch, Text } from '../ui';
import { Unlock, MousePointer, Shield, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ToolHeader from '../components/ui/ToolHeader';

interface UtilitiesPageProps {
    onBack: () => void;
}

export default function UtilitiesPage({ onBack }: UtilitiesPageProps) {
    const { t } = useTranslation('utilities');
    const [rightClickEnabled, setRightClickEnabled] = useState(false);
    const [loading, setLoading] = useState(false);

    const toggleRightClick = async () => {
        setLoading(true);
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const newState = !rightClickEnabled;
                const response = await sendToTab(tab.id, 'TOGGLE_RIGHT_CLICK', { enable: newState });
                if (response.success) {
                    setRightClickEnabled(response.enabled);
                }
            }
        } catch (error) {
            console.error('Failed to toggle right click', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={t('title')} subtitle={t('subtitle')} onBack={onBack} />
            <div className="flex-1 overflow-y-auto p-4">
                <Stack gap={3}>
                    <Card tone={rightClickEnabled ? 'mint' : 'plain'} className="transition-colors duration-200">
                        <div className="flex items-center gap-3">
                            <span className={rightClickEnabled
                                ? 'flex size-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand text-on-brand'
                                : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink/6 text-ink-2'}>
                                <Unlock size={19} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <Text weight="semibold">{t('rightClickUnlocker.title')}</Text>
                                    {rightClickEnabled && <Chip tone="brand">{t('rightClickUnlocker.active')}</Chip>}
                                </div>
                                <Text size="caption" tone="muted" className="mt-0.5">{t('rightClickUnlocker.description')}</Text>
                            </div>
                            <Switch checked={rightClickEnabled} onChange={() => void toggleRightClick()} disabled={loading} aria-label={t('rightClickUnlocker.title')} />
                        </div>
                        <Collapse open={rightClickEnabled}>
                            <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 text-caption text-ink-2">
                                <span className="flex items-center gap-1"><MousePointer size={12} />{t('rightClickUnlocker.rightClick')}</span>
                                <span className="flex items-center gap-1"><Shield size={12} />{t('rightClickUnlocker.copyPaste')}</span>
                                <span className="flex items-center gap-1"><Zap size={12} />{t('rightClickUnlocker.textSelect')}</span>
                            </div>
                        </Collapse>
                    </Card>
                    <div className="rounded-card border-[1.5px] border-dashed border-line p-4 text-center">
                        <Text size="caption" weight="semibold" tone="faint">{t('comingSoon')}</Text>
                    </div>
                </Stack>
            </div>
        </div>
    );
}
