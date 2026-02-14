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
    ListItemButton
} from '@mui/material';
import {
    ChevronLeft,
    Trash2,
    Github,
    Mail,
    HardDrive,
    User,
    ShieldCheck,
    Globe
} from 'lucide-react';
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

    useEffect(() => {
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
            // Process in chunks or sequentially
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

    const formatBytes = (bytes: number, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
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
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="subtitle2" fontWeight="700">Current Plan</Typography>
                            <Box sx={{
                                px: 1.5, py: 0.5,
                                bgcolor: 'success.dark',
                                color: 'white',
                                borderRadius: 999,
                                fontSize: '0.7rem',
                                fontWeight: 'bold'
                            }}>
                                FREE EXPERIMENTATION
                            </Box>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            You are currently using the free experimentation tier. Enjoy unlimited access to basic features.
                        </Typography>
                    </Paper>
                </Section>

                {/* Storage Management */}
                <Section title="Data & Storage" icon={<HardDrive size={18} />}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 3 }}>

                        {/* Usage Stats */}
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

                        {/* Clear Data */}
                        <Box>
                            <Typography variant="subtitle2" fontWeight="600" gutterBottom>
                                Auto-Clear Old Data
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                                Remove data older than the selected timeframe to free up space.
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

                {/* About & Support */}
                <Section title="Support & Community" icon={<Globe size={18} />}>
                    <Paper variant="outlined" sx={{ borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden' }}>
                        <List disablePadding>
                            <ListItemButton component="a" href="mailto:support@crawlpilot.com">
                                <ListItemIcon><Mail size={20} /></ListItemIcon>
                                <ListItemText
                                    primary="Contact Support"
                                    secondary="Email us for help or feature requests"
                                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                                />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItemButton component="a" href="https://github.com/crawlpilot/" target="_blank">
                                <ListItemIcon><Github size={20} /></ListItemIcon>
                                <ListItemText
                                    primary="GitHub Repository"
                                    secondary="Star us, report bugs, or contribute"
                                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                                />
                            </ListItemButton>
                            <Divider component="li" />
                            <ListItem>
                                <ListItemIcon><ShieldCheck size={20} /></ListItemIcon>
                                <ListItemText
                                    primary="Version"
                                    secondary={`v${chrome.runtime.getManifest().version}`}
                                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                                />
                            </ListItem>
                        </List>
                    </Paper>
                </Section>
            </Box>

            {/* Confirm Dialog */}
            <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)}>
                <DialogTitle>Confirm Deletion</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to delete <b>{jobsToDelete.length}</b> jobs older than {daysRetain} days?
                        This action cannot be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmClearOpen(false)} color="inherit">Cancel</Button>
                    <Button onClick={handleClearData} color="error" variant="contained" disabled={clearing}>
                        {clearing ? 'Clearing...' : 'Yes, Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
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
