import { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Divider,
    Button,
    IconButton,
    Slider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    ListItemButton,
    MenuItem,
    Select,
    alpha
} from '@mui/material';
import {
    ChevronLeft,
    Trash2,
    Github,
    Mail,
    HardDrive,
    ShieldCheck,
    Globe,
    AlertTriangle,
    Share2,
    Webhook,
    Link2,
    CheckCircle2,
    Database,
    MessageSquare
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGS, LANG_LABELS, type SupportedLang } from '../../i18n';

// TO CONFIGURE: replace REPLACE_ME with the same Google Form URL used in background/index.ts
const FEEDBACK_FORM_URL = 'https://forms.gle/REPLACE_ME';
import { db } from '../../shared/db/db-manager';
import { useJobHistory } from '../hooks/useDatabase';

interface SettingsPageProps {
    onBack: () => void;
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
    const { t } = useTranslation('settings');
    const { jobs, deleteJob, refresh } = useJobHistory();
    const [currentLang, setCurrentLang] = useState<SupportedLang>(i18n.language as SupportedLang);

    const handleLanguageChange = (lang: SupportedLang) => {
        setCurrentLang(lang);
        i18n.changeLanguage(lang);
        chrome.storage.local.set({ language: lang });
    };
    const [storageUsage, setStorageUsage] = useState<{ usage: number, quota: number } | null>(null);
    const [daysRetain, setDaysRetain] = useState<number>(30);
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmNukeOpen, setConfirmNukeOpen] = useState(false);
    const [nuking, setNuking] = useState(false);
    const [nukeConfirmText, setNukeConfirmText] = useState('');



    const [integrations, setIntegrations] = useState({
        webhookUrl: '',
        zapierUrl: '',
        airtableApiKey: '',
        airtableBaseId: '',
        airtableTableName: '',
        googleSheetsConnected: false
    });

    useEffect(() => {
        // Fetch data from storage
        chrome.storage.local.get(['integrations'], (result) => {
            if (result.integrations) {
                setIntegrations(prev => ({ ...prev, ...(result.integrations as any) }));
            }
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
            await db.clearAllData();
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
        chrome.storage.local.set({ integrations: next });
    };

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflowY: 'auto'
        }}>
            {/* Header */}
            <Box sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <IconButton onClick={onBack} size="small">
                    <ChevronLeft size={20} />
                </IconButton>
                <Typography variant="h6" fontWeight="bold">{t('title')}</Typography>
            </Box>

            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>

                {/* Language */}
                <Section title={t('language.title')} icon={<Globe size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper' }}>
                        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                            {t('language.description')}
                        </Typography>
                        <Select
                            value={currentLang}
                            onChange={(e) => handleLanguageChange(e.target.value as SupportedLang)}
                            size="small"
                            fullWidth
                            sx={{ borderRadius: 2 }}
                        >
                            {SUPPORTED_LANGS.map((lang) => (
                                <MenuItem key={lang} value={lang}>
                                    {LANG_LABELS[lang]}
                                </MenuItem>
                            ))}
                        </Select>
                    </Paper>
                </Section>

                {/* Storage Management */}
                <Section title={t('dataStorage.title')} icon={<HardDrive size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="body2" color="text.secondary">{t('dataStorage.storageUsed')}</Typography>
                                <Typography variant="body2" fontWeight="bold">
                                    {storageUsage ? formatBytes(storageUsage.usage) : t('dataStorage.calculating')}
                                </Typography>
                            </Box>
                            {storageUsage && (
                                <Box sx={{ width: '100%', height: 6, bgcolor: 'action.hover', borderRadius: 999, overflow: 'hidden' }}>
                                    <Box sx={{
                                        width: `${Math.min((storageUsage.usage / (storageUsage.quota || 1)) * 100, 100)}%`,
                                        height: '100%',
                                        bgcolor: 'primary.main'
                                    }} />
                                </Box>
                            )}
                        </Box>
                        <Divider />
                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom>
                                {t('dataStorage.autoClear')}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                                {t('dataStorage.autoClearDescription')}
                            </Typography>
                            <Box sx={{ px: 1 }}>
                                <Slider
                                    value={daysRetain}
                                    onChange={(_, v) => setDaysRetain(v as number)}
                                    min={1}
                                    max={90}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={v => t('dataStorage.daysLabel', { count: v })}
                                    marks={[
                                        { value: 7, label: '7d' },
                                        { value: 30, label: '30d' },
                                        { value: 60, label: '60d' },
                                        { value: 90, label: '90d' }
                                    ]}
                                />
                            </Box>
                            <Button
                                variant="outlined"
                                color="error"
                                fullWidth
                                startIcon={<Trash2 size={16} />}
                                onClick={() => setConfirmClearOpen(true)}
                                disabled={jobsToDelete.length === 0}
                                sx={{ mt: 2 }}
                            >
                                {t('dataStorage.clearButton', { days: daysRetain, count: jobsToDelete.length })}
                            </Button>
                        </Box>
                    </Paper>
                </Section>

                {/* Integrations (PRO) */}
                <Section title={t('integrations.title')} icon={<Link2 size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Box sx={{ p: 1.5, bgcolor: alpha('#ff9800', 0.1), borderRadius: 2, border: '1px solid', borderColor: alpha('#ff9800', 0.2) }}>
                            <Typography variant="caption" color="warning.main" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                <AlertTriangle size={14} /> {t('integrations.proFeature')}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                                {t('integrations.proDescription')}
                            </Typography>
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Webhook size={16} /> {t('integrations.webhookZapier')}
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                                <IntegrationInput
                                    label={t('integrations.webhookUrl')}
                                    value={integrations.webhookUrl}
                                    placeholder="https://your-api.com/webhook"
                                    disabled
                                    onChange={(v) => updateIntegration({ webhookUrl: v })}
                                />
                                <IntegrationInput
                                    label={t('integrations.zapierWebhook')}
                                    value={integrations.zapierUrl}
                                    placeholder="https://hooks.zapier.com/..."
                                    disabled
                                    onChange={(v) => updateIntegration({ zapierUrl: v })}
                                />
                            </Box>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Database size={16} /> {t('integrations.airtable')}
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                                <IntegrationInput
                                    label={t('integrations.apiKey')}
                                    value={integrations.airtableApiKey}
                                    placeholder="pat..."
                                    type="password"
                                    disabled
                                    onChange={(v) => updateIntegration({ airtableApiKey: v })}
                                />
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <IntegrationInput
                                        label={t('integrations.baseId')}
                                        value={integrations.airtableBaseId}
                                        placeholder="app..."
                                        disabled
                                        onChange={(v) => updateIntegration({ airtableBaseId: v })}
                                    />
                                    <IntegrationInput
                                        label={t('integrations.tableName')}
                                        value={integrations.airtableTableName}
                                        placeholder="Records"
                                        disabled
                                        onChange={(v) => updateIntegration({ airtableTableName: v })}
                                    />
                                </Box>
                            </Box>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Share2 size={16} /> {t('integrations.googleSheets')}
                            </Typography>
                            <Button
                                variant="outlined"
                                color={integrations.googleSheetsConnected ? "success" : "inherit"}
                                fullWidth
                                size="small"
                                disabled
                                startIcon={integrations.googleSheetsConnected ? <CheckCircle2 size={16} /> : <Share2 size={16} />}
                                onClick={() => {
                                    alert("Google Sheets Authentication is coming soon.");
                                }}
                                sx={{ mt: 1, borderColor: 'divider', textTransform: 'none' }}
                            >
                                {integrations.googleSheetsConnected ? t('integrations.connectedSheets') : t('integrations.connectSheets')}
                            </Button>
                        </Box>
                    </Paper>
                </Section>

                {/* Feedback */}
                <Section title={t('feedback.title')} icon={<MessageSquare size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper' }}>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            {t('feedback.description')}
                        </Typography>
                        <Button
                            variant="outlined"
                            fullWidth
                            startIcon={<MessageSquare size={16} />}
                            onClick={() => chrome.tabs.create({ url: FEEDBACK_FORM_URL })}
                            sx={{ textTransform: 'none' }}
                        >
                            {t('feedback.openForm')}
                        </Button>
                    </Paper>
                </Section>

                {/* Danger Zone */}
                <Section title={t('dangerZone.title')} icon={<AlertTriangle size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', borderColor: 'error.dark', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                            <AlertTriangle size={20} color="#f44336" style={{ flexShrink: 0, marginTop: 2 }} />
                            <Box>
                                <Typography variant="subtitle2" fontWeight={700} color="error.main">{t('dangerZone.deleteAll')}</Typography>
                                <Typography variant="caption" color="text.secondary">{t('dangerZone.deleteAllDescription')}</Typography>
                            </Box>
                        </Box>
                        <Button
                            variant="contained"
                            color="error"
                            fullWidth
                            startIcon={<Trash2 size={16} />}
                            onClick={() => { setNukeConfirmText(''); setConfirmNukeOpen(true); }}
                        >
                            {t('dangerZone.deleteAll')}
                        </Button>
                    </Paper>
                </Section>

                {/* About & Support */}
                <Section title={t('support.title')} icon={<Globe size={18} />}>
                    <Paper variant="outlined" sx={{ borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden' }}>
                        <List disablePadding>
                            <ListItemButton component="a" href="mailto:crawlpilot6365@gmail.com">
                                <ListItemIcon><Mail size={20} /></ListItemIcon>
                                <ListItemText primary={t('support.contactSupport')} secondary={t('support.contactSupportSub')} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItemButton component="a" href="https://github.com/crawlpilot/" target="_blank">
                                <ListItemIcon><Github size={20} /></ListItemIcon>
                                <ListItemText primary={t('support.github')} secondary={t('support.githubSub')} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItem>
                                <ListItemIcon><ShieldCheck size={20} /></ListItemIcon>
                                <ListItemText primary={t('support.version')} secondary={`v${chrome.runtime.getManifest().version}`} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItem>
                        </List>
                    </Paper>
                </Section>
            </Box>

            {/* Dialogs */}
            <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)}>
                <DialogTitle>{t('dangerZone.confirmDeletion')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('dangerZone.deleteJobsConfirm', { count: jobsToDelete.length })}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmClearOpen(false)} color="inherit">{t('cancel', { ns: 'common' })}</Button>
                    <Button onClick={handleClearData} color="error" variant="contained" disabled={clearing}>{t('clear', { ns: 'common' })}</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={confirmNukeOpen} onClose={() => setConfirmNukeOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ color: 'error.main' }}>{t('dangerZone.deleteAll')}?</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" mb={2}>{t('dangerZone.typeToConfirm')}</Typography>
                    <input
                        autoFocus
                        value={nukeConfirmText}
                        onChange={e => setNukeConfirmText(e.target.value.toUpperCase())}
                        style={{ width: '100%', padding: '8px', border: '1px solid #f44336', borderRadius: 4, background: 'transparent', color: 'inherit' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmNukeOpen(false)} color="inherit">{t('cancel', { ns: 'common' })}</Button>
                    <Button onClick={handleNukeAllData} color="error" variant="contained" disabled={nuking || nukeConfirmText !== 'DELETE'}>{t('dangerZone.deleteEverything')}</Button>
                </DialogActions>
            </Dialog>
        </Box >
    );
}

function Section({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
    return (
        <Box>
            <Typography variant="overline" color="text.secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1 }}>
                {icon}
                {title}
            </Typography>
            {children}
        </Box>
    );
}

function IntegrationInput({ label, value, onChange, placeholder, disabled, type = 'text' }: { label: string, value: string, onChange: (v: string) => void, placeholder?: string, disabled?: boolean, type?: string }) {
    return (
        <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>{label}</Typography>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                type={type}
                style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.03)',
                    color: disabled ? 'rgba(255, 255, 255, 0.3)' : 'inherit',
                    fontSize: 12,
                    outline: 'none',
                    boxSizing: 'border-box'
                }}
            />
        </Box>
    );
}
