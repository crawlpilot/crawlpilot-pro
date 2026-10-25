import { useState, useEffect, useMemo } from 'react';
import ToolHeader from '../components/ui/ToolHeader';
import { setAppearance, useColorMode } from '../theme/colorMode';
import type { Appearance } from '@/shared/storage';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Button, Card, Dialog, Divider, Progress, Segmented, Select, Slider, Text, TextField } from '../ui';
import {
    Trash2,
    Github,
    Mail,
    HardDrive,
    ShieldCheck,
    Globe,
    AlertTriangle,
    Webhook,
    Link2,
    Database,
    MessageSquare,
    ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGS, LANG_LABELS, type SupportedLang } from '../../i18n';

// TO CONFIGURE: replace REPLACE_ME with the same Google Form URL used in background/index.ts
const FEEDBACK_FORM_URL = 'https://forms.gle/REPLACE_ME';
import { db } from '../../shared/db';
import { useJobHistory } from '../hooks/useDatabase';
import { DEFAULT_INTEGRATIONS, Integrations, storage } from '../../shared/storage';
import { SheetsConnect } from '../components/integrations/SheetsConnect';

interface SettingsPageProps {
    onBack: () => void;
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
    const { appearance } = useColorMode();
    const { t } = useTranslation('settings');
    const { jobs, deleteJob, refresh } = useJobHistory();
    const [currentLang, setCurrentLang] = useState<SupportedLang>(i18n.language as SupportedLang);

    const handleLanguageChange = (lang: SupportedLang) => {
        setCurrentLang(lang);
        i18n.changeLanguage(lang);
        void storage.set('language', lang);
    };
    const [storageUsage, setStorageUsage] = useState<{ usage: number, quota: number } | null>(null);
    const [daysRetain, setDaysRetain] = useState<number>(30);
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmNukeOpen, setConfirmNukeOpen] = useState(false);
    const [nuking, setNuking] = useState(false);
    const [nukeConfirmText, setNukeConfirmText] = useState('');



    const [integrations, setIntegrations] = useState<Integrations>(DEFAULT_INTEGRATIONS);

    useEffect(() => {
        // Fetch data from storage
        void storage.get('integrations').then(saved => {
            if (saved) setIntegrations(prev => ({ ...prev, ...saved }));
        });

        // Estimate storage usage
        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then(estimate => {
                setStorageUsage({
                    usage: estimate.usage || 0,
                    quota: estimate.quota || 0
                });
            });
        }
    }, []);

    const jobsToDelete = useMemo(() => {
        const cutoff = Date.now() - (daysRetain * 24 * 60 * 60 * 1000);
        return jobs.filter(j => j.createdAt < cutoff);
    }, [jobs, daysRetain]);

    const handleClearData = async () => {
        if (jobsToDelete.length === 0) return;
        setClearing(true);
        try {
            console.log(`Deleting ${jobsToDelete.length} jobs older than ${daysRetain} days...`);
            for (const job of jobsToDelete) {
                if (job.id) await deleteJob(job.id);
            }
            await refresh();
            setConfirmClearOpen(false);
        } catch (e) {
            console.error("Failed to clear data", e);
            alert("Failed to clear some data.");
        } finally {
            setClearing(false);
        }
    };

    const handleNukeAllData = async () => {
        if (nukeConfirmText !== 'DELETE') return;
        setNuking(true);
        try {
            await db.clearAll();
            await refresh();
            setConfirmNukeOpen(false);
            setNukeConfirmText('');
        } catch (e) {
            console.error('Failed to nuke data', e);
            alert('Failed to delete all data.');
        } finally {
            setNuking(false);
        }
    };



    const formatBytes = (bytes: number, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    const updateIntegration = (updates: Partial<typeof integrations>) => {
        const next = { ...integrations, ...updates };
        setIntegrations(next);
        void storage.set('integrations', next);
    };

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-bg">
            <div className="sticky top-0 z-10">
                <ToolHeader title={t('title')} onBack={onBack} />
            </div>

            <div className="flex flex-1 flex-col gap-6 p-4 pb-8">
                <Section title={t('language.title')} icon={<Globe />}>
                    <Card>
                        <Select label={t('language.description')} value={currentLang} onChange={handleLanguageChange}
                            options={SUPPORTED_LANGS.map(lang => ({ value: lang, label: LANG_LABELS[lang] }))} />
                    </Card>
                </Section>

                <Section title={t('appearance.title')} icon={<Palette />}>
                    <Segmented fullWidth aria-label={t('appearance.title')} value={appearance} onChange={(v: Appearance) => void setAppearance(v)}
                        options={(['light', 'dark', 'system'] as const).map(a => ({
                            value: a,
                            label: t(`appearance.${a}`),
                            icon: a === 'light' ? <Sun /> : a === 'dark' ? <Moon /> : <Monitor />,
                        }))} />
                </Section>

                <Section title={t('dataStorage.title')} icon={<HardDrive />}>
                    <Card className="flex flex-col gap-4">
                        <div>
                            <div className="mb-2 flex justify-between">
                                <Text size="small" tone="muted">{t('dataStorage.storageUsed')}</Text>
                                <Text size="small" weight="bold">{storageUsage ? formatBytes(storageUsage.usage) : t('dataStorage.calculating')}</Text>
                            </div>
                            {storageUsage && <Progress size="sm" value={Math.min((storageUsage.usage / (storageUsage.quota || 1)) * 100, 100)} label={t('dataStorage.storageUsed')} />}
                        </div>
                        <Divider />
                        <div className="flex flex-col gap-3">
                            <div>
                                <Text weight="semibold">{t('dataStorage.autoClear')}</Text>
                                <Text size="caption" tone="muted">{t('dataStorage.autoClearDescription')}</Text>
                            </div>
                            <Slider value={daysRetain} onChange={setDaysRetain} min={1} max={90} valueLabel={t('dataStorage.daysLabel', { count: daysRetain })} />
                            <Button variant="danger" fullWidth icon={<Trash2 />} onClick={() => setConfirmClearOpen(true)} disabled={jobsToDelete.length === 0}>
                                {t('dataStorage.clearButton', { days: daysRetain, count: jobsToDelete.length })}
                            </Button>
                        </div>
                    </Card>
                </Section>

                <Section title={t('integrations.title')} icon={<Link2 />}>
                    <SheetsConnect />
                    <Card className="flex flex-col gap-4">
                        <Text size="caption" tone="muted">{t('integrations.hint')}</Text>
                        <div className="flex flex-col gap-2.5">
                            <Text weight="semibold" className="flex items-center gap-2"><Webhook size={16} /> {t('integrations.webhookZapier')}</Text>
                            <TextField size="sm" label={t('integrations.webhookUrl')} value={integrations.webhookUrl} placeholder="https://your-api.com/webhook"
                                onChange={e => updateIntegration({ webhookUrl: e.target.value })} />
                            <TextField size="sm" label={t('integrations.zapierWebhook')} value={integrations.zapierUrl} placeholder="https://hooks.zapier.com/..."
                                onChange={e => updateIntegration({ zapierUrl: e.target.value })} />
                        </div>
                        <Divider />
                        <div className="flex flex-col gap-2.5">
                            <Text weight="semibold" className="flex items-center gap-2"><Database size={16} /> {t('integrations.airtable')}</Text>
                            <TextField size="sm" type="password" label={t('integrations.apiKey')} value={integrations.airtableApiKey} placeholder="pat..."
                                onChange={e => updateIntegration({ airtableApiKey: e.target.value })} />
                            <div className="flex gap-2">
                                <TextField size="sm" className="flex-1" label={t('integrations.baseId')} value={integrations.airtableBaseId} placeholder="app..."
                                    onChange={e => updateIntegration({ airtableBaseId: e.target.value })} />
                                <TextField size="sm" className="flex-1" label={t('integrations.tableName')} value={integrations.airtableTableName} placeholder="Records"
                                    onChange={e => updateIntegration({ airtableTableName: e.target.value })} />
                            </div>
                        </div>
                    </Card>
                </Section>

                <Section title={t('feedback.title')} icon={<MessageSquare />}>
                    <Card tone="lilac" className="flex flex-col gap-3">
                        <Text size="small">{t('feedback.description')}</Text>
                        <Button variant="primary" icon={<MessageSquare />} onClick={() => chrome.tabs.create({ url: FEEDBACK_FORM_URL })}>{t('feedback.openForm')}</Button>
                    </Card>
                </Section>

                <Section title={t('dangerZone.title')} icon={<AlertTriangle />}>
                    <Card className="flex flex-col gap-3 border-danger/40!">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" />
                            <div>
                                <Text weight="bold" tone="danger">{t('dangerZone.deleteAll')}</Text>
                                <Text size="caption" tone="muted">{t('dangerZone.deleteAllDescription')}</Text>
                            </div>
                        </div>
                        <Button variant="danger" fullWidth icon={<Trash2 />} onClick={() => { setNukeConfirmText(''); setConfirmNukeOpen(true); }}>
                            {t('dangerZone.deleteAll')}
                        </Button>
                    </Card>
                </Section>

                <Section title={t('support.title')} icon={<Globe />}>
                    <Card pad="none" className="overflow-hidden">
                        <LinkRow href="mailto:crawlpilot6365@gmail.com" icon={<Mail />} title={t('support.contactSupport')} hint={t('support.contactSupportSub')} />
                        <LinkRow href="https://github.com/crawlpilot/" icon={<Github />} title={t('support.github')} hint={t('support.githubSub')} />
                        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
                            <span className="flex text-ink-2"><ShieldCheck size={18} /></span>
                            <div>
                                <Text size="small" weight="semibold">{t('support.version')}</Text>
                                <Text size="caption" tone="faint">v{chrome.runtime.getManifest().version}</Text>
                            </div>
                        </div>
                    </Card>
                </Section>
            </div>

            <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)} size="sm" title={t('dangerZone.confirmDeletion')}
                actions={<>
                    <Button variant="ghost" onClick={() => setConfirmClearOpen(false)}>{t('cancel', { ns: 'common' })}</Button>
                    <Button variant="danger" onClick={handleClearData} loading={clearing}>{t('clear', { ns: 'common' })}</Button>
                </>}>
                <Text>{t('dangerZone.deleteJobsConfirm', { count: jobsToDelete.length })}</Text>
            </Dialog>

            <Dialog open={confirmNukeOpen} onClose={() => setConfirmNukeOpen(false)} size="sm" title={`${t('dangerZone.deleteAll')}?`}
                actions={<>
                    <Button variant="ghost" onClick={() => setConfirmNukeOpen(false)}>{t('cancel', { ns: 'common' })}</Button>
                    <Button variant="danger" onClick={handleNukeAllData} loading={nuking} disabled={nukeConfirmText !== 'DELETE'}>{t('dangerZone.deleteEverything')}</Button>
                </>}>
                <Text size="small" className="mb-3">{t('dangerZone.typeToConfirm')}</Text>
                <TextField autoFocus value={nukeConfirmText} onChange={e => setNukeConfirmText(e.target.value.toUpperCase())} error={nukeConfirmText.length > 0 && nukeConfirmText !== 'DELETE'} />
            </Dialog>
        </div>
    );
}

function Section({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="m-0 flex items-center gap-2 px-0.5 text-small font-semibold text-ink-2 [&_svg]:size-4">{icon}{title}</h2>
            {children}
        </section>
    );
}

function LinkRow({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
    return (
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
            className="flex items-center gap-3 border-t border-line px-4 py-3 text-ink no-underline first:border-t-0 hover:bg-ink/4">
            <span className="flex text-ink-2 [&_svg]:size-[18px]">{icon}</span>
            <div className="min-w-0 flex-1">
                <Text size="small" weight="semibold">{title}</Text>
                <Text size="caption" tone="faint">{hint}</Text>
            </div>
            <ChevronRight size={15} className="text-ink-3" />
        </a>
    );
}
