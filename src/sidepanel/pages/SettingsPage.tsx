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
    alpha
} from '@mui/material';
import {
    ChevronLeft,
    Trash2,
    Github,
    Mail,
    HardDrive,
    User,
    ShieldCheck,
    Globe,
    AlertTriangle,
    Share2,
    LogOut,
    Webhook,
    Link2,
    CheckCircle2,
    Database
} from 'lucide-react';
import { db } from '../../shared/db/db-manager';
import { useJobHistory } from '../hooks/useDatabase';

interface SettingsPageProps {
    onBack: () => void;
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
    const { jobs, deleteJob, refresh } = useJobHistory();
    const [storageUsage, setStorageUsage] = useState<{ usage: number, quota: number } | null>(null);
    const [daysRetain, setDaysRetain] = useState<number>(30);
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmNukeOpen, setConfirmNukeOpen] = useState(false);
    const [nuking, setNuking] = useState(false);
    const [nukeConfirmText, setNukeConfirmText] = useState('');

    const [userProfile, setUserProfile] = useState<{
        email: string;
        plan: string;
        lastLogin: string;
    }>({
        email: 'Authenticated User',
        plan: 'free',
        lastLogin: ''
    });

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
        chrome.storage.local.get(['user_email', 'user_plan', 'last_login', 'integrations'], (result) => {
            setUserProfile({
                email: (result.user_email as string) || 'Authenticated User',
                plan: (result.user_plan as string) || 'free',
                lastLogin: result.last_login ? new Date(result.last_login as string).toLocaleString() : ''
            });
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

    const handleLogout = () => {
        chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' }, (response) => {
            if (response?.success) {
                console.log('Logged out successfully');
            }
        });
    };

    const formatBytes = (bytes: number, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    const isPaid = userProfile.plan === 'paid';

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
                <Typography variant="h6" fontWeight="bold">Settings</Typography>
            </Box>

            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>

                {/* Account / User Section */}
                <Section title="Account & Plan" icon={<User size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Box>
                                <Typography variant="subtitle2" fontWeight="700">Account</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {userProfile.email}
                                </Typography>
                                {userProfile.lastLogin && (
                                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
                                        Last login: {userProfile.lastLogin}
                                    </Typography>
                                )}
                            </Box>
                            <Box sx={{
                                px: 1.5, py: 0.5,
                                bgcolor: isPaid ? 'primary.main' : 'success.dark',
                                color: 'white',
                                borderRadius: 999,
                                fontSize: '0.65rem',
                                fontWeight: 'bold',
                                textTransform: 'uppercase'
                            }}>
                                {isPaid ? 'PRO PLAN' : 'FREE VERSION'}
                            </Box>
                        </Box>
                        <Divider sx={{ my: 1.5 }} />
                        <Button
                            variant="outlined"
                            color="inherit"
                            size="small"
                            fullWidth
                            startIcon={<LogOut size={16} />}
                            onClick={handleLogout}
                            sx={{ borderColor: 'divider', textTransform: 'none', fontWeight: 600 }}
                        >
                            Sign Out
                        </Button>
                    </Paper>
                </Section>

                {/* Storage Management */}
                <Section title="Data & Storage" icon={<HardDrive size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="body2" color="text.secondary">Storage Used</Typography>
                                <Typography variant="body2" fontWeight="bold">
                                    {storageUsage ? formatBytes(storageUsage.usage) : 'Calculating...'}
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
                                Auto-Clear Old Data
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                                Remove data older than the selected timeframe.
                            </Typography>
                            <Box sx={{ px: 1 }}>
                                <Slider
                                    value={daysRetain}
                                    onChange={(_, v) => setDaysRetain(v as number)}
                                    min={1}
                                    max={90}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={v => `${v} Days`}
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
                                Clear Data Older Than {daysRetain} Days ({jobsToDelete.length} Jobs)
                            </Button>
                        </Box>
                    </Paper>
                </Section>

                {/* Integrations (PRO) */}
                <Section title="Integrations (PRO)" icon={<Link2 size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {!isPaid && (
                            <Box sx={{ p: 1.5, bgcolor: alpha('#ff9800', 0.1), borderRadius: 2, border: '1px solid', borderColor: alpha('#ff9800', 0.2) }}>
                                <Typography variant="caption" color="warning.main" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                    <AlertTriangle size={14} /> PRO FEATURE
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                                    Upgrade to PRO to unlock Webhooks, Airtable, and Google Sheets integrations.
                                </Typography>
                            </Box>
                        )}

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Webhook size={16} /> Webhook & Zapier
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                                <IntegrationInput
                                    label="Webhook URL"
                                    value={integrations.webhookUrl}
                                    placeholder="https://your-api.com/webhook"
                                    disabled={!isPaid}
                                    onChange={(v) => updateIntegration({ webhookUrl: v })}
                                />
                                <IntegrationInput
                                    label="Zapier Webhook"
                                    value={integrations.zapierUrl}
                                    placeholder="https://hooks.zapier.com/..."
                                    disabled={!isPaid}
                                    onChange={(v) => updateIntegration({ zapierUrl: v })}
                                />
                            </Box>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Database size={16} /> Airtable
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                                <IntegrationInput
                                    label="API Key"
                                    value={integrations.airtableApiKey}
                                    placeholder="pat..."
                                    type="password"
                                    disabled={!isPaid}
                                    onChange={(v) => updateIntegration({ airtableApiKey: v })}
                                />
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <IntegrationInput
                                        label="Base ID"
                                        value={integrations.airtableBaseId}
                                        placeholder="app..."
                                        disabled={!isPaid}
                                        onChange={(v) => updateIntegration({ airtableBaseId: v })}
                                    />
                                    <IntegrationInput
                                        label="Table Name"
                                        value={integrations.airtableTableName}
                                        placeholder="Records"
                                        disabled={!isPaid}
                                        onChange={(v) => updateIntegration({ airtableTableName: v })}
                                    />
                                </Box>
                            </Box>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Share2 size={16} /> Google Sheets
                            </Typography>
                            <Button
                                variant="outlined"
                                color={integrations.googleSheetsConnected ? "success" : "inherit"}
                                fullWidth
                                size="small"
                                disabled={!isPaid}
                                startIcon={integrations.googleSheetsConnected ? <CheckCircle2 size={16} /> : <Share2 size={16} />}
                                onClick={() => {
                                    alert("Google Sheets Authentication is coming soon.");
                                }}
                                sx={{ mt: 1, borderColor: 'divider', textTransform: 'none' }}
                            >
                                {integrations.googleSheetsConnected ? 'Connected to Google Sheets' : 'Connect Google Sheets'}
                            </Button>
                        </Box>
                    </Paper>
                </Section>

                {/* Danger Zone */}
                <Section title="Danger Zone" icon={<AlertTriangle size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', borderColor: 'error.dark', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                            <AlertTriangle size={20} color="#f44336" style={{ flexShrink: 0, marginTop: 2 }} />
                            <Box>
                                <Typography variant="subtitle2" fontWeight={700} color="error.main">Delete All Data</Typography>
                                <Typography variant="caption" color="text.secondary">Permanently wipes everything. This cannot be undone.</Typography>
                            </Box>
                        </Box>
                        <Button
                            variant="contained"
                            color="error"
                            fullWidth
                            startIcon={<Trash2 size={16} />}
                            onClick={() => { setNukeConfirmText(''); setConfirmNukeOpen(true); }}
                        >
                            Delete All Data
                        </Button>
                    </Paper>
                </Section>

                {/* About & Support */}
                <Section title="Support & Community" icon={<Globe size={18} />}>
                    <Paper variant="outlined" sx={{ borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden' }}>
                        <List disablePadding>
                            <ListItemButton component="a" href="mailto:crawlpilot6365@gmail.com">
                                <ListItemIcon><Mail size={20} /></ListItemIcon>
                                <ListItemText primary="Contact Support" secondary="Email us for help" primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItemButton component="a" href="https://github.com/crawlpilot/" target="_blank">
                                <ListItemIcon><Github size={20} /></ListItemIcon>
                                <ListItemText primary="GitHub Repository" secondary="Star us on GitHub" primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItem>
                                <ListItemIcon><ShieldCheck size={20} /></ListItemIcon>
                                <ListItemText primary="Version" secondary={`v${chrome.runtime.getManifest().version}`} primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
                            </ListItem>
                        </List>
                    </Paper>
                </Section>
            </Box>

            {/* Dialogs */}
            <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)}>
                <DialogTitle>Confirm Deletion</DialogTitle>
                <DialogContent>
                    <Typography>Delete {jobsToDelete.length} old jobs?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmClearOpen(false)} color="inherit">Cancel</Button>
                    <Button onClick={handleClearData} color="error" variant="contained" disabled={clearing}>Clear</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={confirmNukeOpen} onClose={() => setConfirmNukeOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ color: 'error.main' }}>Delete All Data?</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" mb={2}>Type DELETE to confirm:</Typography>
                    <input
                        autoFocus
                        value={nukeConfirmText}
                        onChange={e => setNukeConfirmText(e.target.value.toUpperCase())}
                        style={{ width: '100%', padding: '8px', border: '1px solid #f44336', borderRadius: 4, background: 'transparent', color: 'inherit' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmNukeOpen(false)} color="inherit">Cancel</Button>
                    <Button onClick={handleNukeAllData} color="error" variant="contained" disabled={nuking || nukeConfirmText !== 'DELETE'}>Delete Everything</Button>
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
