import { Box, Typography, Card, CardActionArea, Button, Stack, Tooltip } from '@mui/material';
import { Sparkles, List, Clock, Database, ChevronRight, Image as ImageIcon, FileText, FileSearch, Radar } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HomePageProps {
    onNavigate: (view: string) => void;
    isTabConnected?: boolean;
}

export default function HomePage({ onNavigate, isTabConnected = true }: HomePageProps) {
    const { t } = useTranslation('home');
    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflow: 'hidden'
        }}>
            {/* Assistant Header - Fixed */}
            <Box sx={{ pt: 2.5, pb: 1.5, textAlign: 'center', animation: 'slideUp 0.3s ease-out', px: 3 }}>
                <Box sx={{
                    display: 'inline-flex',
                    p: 1.25,
                    borderRadius: 3,
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(139, 92, 246, 0.15) 100%)',
                    mb: 1,
                    boxShadow: '0 4px 20px -5px rgba(6, 182, 212, 0.4)'
                }}>
                    <Sparkles size={24} style={{ color: '#06B6D4' }} />
                </Box>
                <Typography variant="h5" component="h1" fontWeight="700" gutterBottom sx={{ fontSize: '1.1rem', mb: 0.5 }}>
                    Crawl Pilot
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260, mx: 'auto', fontSize: '0.72rem' }}>
                    {t('tagline')}
                </Typography>
            </Box>

            {/* Main Actions - Scrollable */}
            <Box sx={{
                flex: 1,
                overflowY: 'auto',
                px: 3,
                pb: 2,
                '&::-webkit-scrollbar': { width: '4px' },
                '&::-webkit-scrollbar-track': { background: 'transparent' },
                '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: '10px' },
                '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.2)' }
            }}>
                <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 400, mx: 'auto', animation: 'slideUp 0.4s ease-out' }}>

                    {/* Primary: List Extractor */}
                    <Tooltip title={t('listExtractor.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            opacity: isTabConnected ? 1 : 0.5,
                            '&:hover': {
                                borderColor: 'primary.main',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(6, 182, 212, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('list-extractor')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(6, 182, 212, 0.1)',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <List size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('listExtractor.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('listExtractor.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>

                    {/* Scraper Toolkit */}
                    <Tooltip title={t('scraperToolkit.tooltip', 'Page Recon and Selector Lab: see where the data lives, what protects it, and test selectors')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            opacity: isTabConnected ? 1 : 0.5,
                            '&:hover': {
                                borderColor: 'rgba(245, 158, 11, 0.6)',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(245, 158, 11, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('toolkit')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(245, 158, 11, 0.1)',
                                        color: '#F59E0B',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <Radar size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('scraperToolkit.title', 'Scraper Toolkit')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('scraperToolkit.description', 'Page recon and selector lab')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>

                    {/* Text Summarizer */}
                    <Tooltip title={t('textSummarizer.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            opacity: isTabConnected ? 1 : 0.5,
                            '&:hover': {
                                borderColor: 'primary.main',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(6, 182, 212, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('text-summarizer')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(139, 92, 246, 0.1)',
                                        color: 'secondary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <FileText size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('textSummarizer.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('textSummarizer.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>


                    {/* Page Extractor */}
                    <Tooltip title={t('pageExtractor.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            opacity: isTabConnected ? 1 : 0.5,
                            '&:hover': {
                                borderColor: 'primary.main',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(6, 182, 212, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('page-extractor')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(6, 182, 212, 0.1)',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <Database size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('pageExtractor.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('pageExtractor.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>

                    {/* Metadata Extractor */}
                    <Tooltip title={t('metadataExtractor.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            '&:hover': {
                                borderColor: 'rgba(139, 92, 246, 0.6)',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(139, 92, 246, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('metadata-extractor')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(139, 92, 246, 0.1)',
                                        color: 'secondary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <FileSearch size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('metadataExtractor.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('metadataExtractor.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>

                    {/* Image Downloader */}
                    <Tooltip title={t('imageDownloader.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            opacity: isTabConnected ? 1 : 0.5,
                            '&:hover': {
                                borderColor: 'primary.main',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(6, 182, 212, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('image-downloader')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(16, 185, 129, 0.1)',
                                        color: '#10B981',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <ImageIcon size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('imageDownloader.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('imageDownloader.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>

                    {/* Browser Utilities */}
                    <Tooltip title={t('browserUtilities.tooltip')} placement="left" arrow>
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            transition: 'all 0.2s',
                            '&:hover': {
                                borderColor: 'primary.main',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 8px 25px -8px rgba(6, 182, 212, 0.3)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('utilities')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(245, 158, 11, 0.1)',
                                        color: '#F59E0B',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <Sparkles size={22} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle2" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            {t('browserUtilities.title')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                            {t('browserUtilities.description')}
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </Box>
                        </CardActionArea>
                    </Card>
                    </Tooltip>
                </Stack>
            </Box>

            {/* Footer / Recent - Fixed outside scroll */}
            <Box sx={{
                mt: 'auto',
                pt: 1.5,
                pb: 2,
                px: 3,
                borderTop: '1px solid',
                borderColor: 'rgba(255,255,255,0.05)',
                bgcolor: 'background.default',
            }}>
                <Stack direction="row" spacing={1.5}>
                    <Button
                        fullWidth
                        variant="outlined"
                        color="inherit"
                        startIcon={<Clock size={14} />}
                        onClick={() => onNavigate('history')}
                        sx={{
                            justifyContent: 'center',
                            borderColor: 'divider',
                            color: 'text.secondary',
                            py: 0.8,
                            borderRadius: 2,
                            textTransform: 'none',
                            fontSize: '0.75rem',
                            '&:hover': { borderColor: 'primary.main', color: 'primary.main', transform: 'none' }
                        }}
                    >
                        {t('recentRuns')}
                    </Button>
                    <Button
                        fullWidth
                        variant="outlined"
                        color="inherit"
                        startIcon={<Database size={14} />}
                        onClick={() => {
                            const url = chrome.runtime.getURL('sidepanel.html?view=data-table');
                            chrome.tabs.create({ url });
                        }}
                        sx={{
                            justifyContent: 'center',
                            borderColor: 'divider',
                            color: 'text.secondary',
                            py: 0.8,
                            borderRadius: 2,
                            textTransform: 'none',
                            fontSize: '0.75rem',
                            '&:hover': { borderColor: 'primary.main', color: 'primary.main', transform: 'none' }
                        }}
                    >
                        {t('savedData')}
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}
