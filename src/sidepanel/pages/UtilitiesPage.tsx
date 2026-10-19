import { useState } from 'react';
import { sendToTab } from '../../shared/messages';
import {
    Box, Typography, Stack, Chip, Switch,
     Card, CardContent, Fade
} from '@mui/material';
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
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            <ToolHeader title={t('title')} subtitle={t('subtitle')} onBack={onBack} />

            {/* Content */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2, '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.08)', borderRadius: 4 } }}>
                <Stack spacing={1.5}>
                    {/* Right-Click Unlocker */}
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: rightClickEnabled ? 'rgba(6, 182, 212, 0.3)' : 'divider',
                            bgcolor: rightClickEnabled ? 'rgba(6, 182, 212, 0.04)' : 'background.paper',
                            transition: 'all 0.2s ease',
                            '&:hover': { borderColor: rightClickEnabled ? 'rgba(6, 182, 212, 0.5)' : 'rgba(255,255,255,0.12)' }
                        }}
                    >
                        <CardContent sx={{ p: '16px !important' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box sx={{
                                    p: 1.25,
                                    borderRadius: 2.5,
                                    bgcolor: rightClickEnabled ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.04)',
                                    color: rightClickEnabled ? '#06b6d4' : 'text.secondary',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}>
                                    <Unlock size={20} />
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="subtitle2" fontWeight={650} sx={{ lineHeight: 1.2, fontSize: '0.82rem' }}>
                                            {t('rightClickUnlocker.title')}
                                        </Typography>
                                        {rightClickEnabled && (
                                            <Chip label={t('rightClickUnlocker.active')} size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', borderRadius: '6px' }} />
                                        )}
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem', lineHeight: 1.4, mt: 0.25, display: 'block' }}>
                                        {t('rightClickUnlocker.description')}
                                    </Typography>
                                </Box>
                                <Switch
                                    checked={rightClickEnabled}
                                    onChange={toggleRightClick}
                                    disabled={loading}
                                    size="small"
                                    sx={{
                                        '& .MuiSwitch-switchBase.Mui-checked': { color: '#06b6d4' },
                                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#06b6d4' }
                                    }}
                                />
                            </Box>
                            <Fade in={rightClickEnabled}>
                                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                    <Stack direction="row" spacing={1.5}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                                            <MousePointer size={11} />
                                            <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{t('rightClickUnlocker.rightClick')}</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                                            <Shield size={11} />
                                            <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{t('rightClickUnlocker.copyPaste')}</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                                            <Zap size={11} />
                                            <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{t('rightClickUnlocker.textSelect')}</Typography>
                                        </Box>
                                    </Stack>
                                </Box>
                            </Fade>
                        </CardContent>
                    </Card>

                    {/* Coming Soon Placeholder */}
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px dashed',
                            borderColor: 'rgba(255,255,255,0.06)',
                            bgcolor: 'rgba(255,255,255,0.01)',
                        }}
                    >
                        <CardContent sx={{ p: '14px !important', textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.68rem', opacity: 0.5 }}>
                                {t('comingSoon')}
                            </Typography>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>
        </Box>
    );
}
