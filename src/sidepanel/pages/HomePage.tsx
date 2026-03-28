import { Box, Typography, Card, CardActionArea, Button, Stack } from '@mui/material';
import { Sparkles, List, Clock, Database, ChevronRight, Image as ImageIcon, FileText } from 'lucide-react';

interface HomePageProps {
    onNavigate: (view: string) => void;
}

export default function HomePage({ onNavigate }: HomePageProps) {
    return (
        <Box sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflow: 'hidden'
        }}>
            {/* Assistant Header - Fixed */}
            <Box sx={{ pt: 4, pb: 2, textAlign: 'center', animation: 'slideUp 0.3s ease-out', px: 3 }}>
                <Box sx={{
                    display: 'inline-flex',
                    p: 1.5,
                    borderRadius: 3,
                    background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2) 0%, rgba(96, 165, 250, 0.2) 100%)',
                    mb: 2,
                    boxShadow: '0 4px 20px -5px rgba(37, 99, 235, 0.4)'
                }}>
                    <Sparkles className="w-8 h-8 text-blue-500" />
                </Box>
                <Typography variant="h5" component="h1" fontWeight="700" gutterBottom sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                    Welcome to Crawl Pilot
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260, mx: 'auto' }}>
                    Your intelligent web crawling companion.
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
                <Stack spacing={2} sx={{ width: '100%', maxWidth: 400, mx: 'auto', animation: 'slideUp 0.4s ease-out' }}>

                    {/* Primary: List Extractor */}
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
                                boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('list-extractor')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(37, 99, 235, 0.1)',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <List size={24} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            Extract a List
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            Products, articles, or search results
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={20} className="text-gray-500" />
                            </Box>
                        </CardActionArea>
                    </Card>

                    {/* Text Summarizer */}
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
                                boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('text-summarizer')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(37, 99, 235, 0.1)',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <FileText size={24} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            Text Summarizer
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            Summarize and chat with text
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={20} className="text-gray-500" />
                            </Box>
                        </CardActionArea>
                    </Card>


                    {/* Page Extractor */}
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
                                boxShadow: '0 10px 30px -10px rgba(0,0,0,0.5)'
                            }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('page-extractor')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: 'rgba(37, 99, 235, 0.1)',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <Database size={24} />
                                    </Box>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                                            Page Extractor
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            Bulk extract data from pages
                                        </Typography>
                                    </Box>
                                </Box>
                                <ChevronRight size={20} className="text-gray-500" />
                            </Box>
                        </CardActionArea>
                    </Card>

                    {/* Image Downloader */}
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'transparent',
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('image-downloader')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1,
                                        borderRadius: 1.5,
                                        bgcolor: 'rgba(255,255,255,0.05)',
                                        color: 'text.secondary',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <ImageIcon size={20} />
                                    </Box>
                                    <Box>
                                        <Typography variant="body2" fontWeight="500">
                                            Image Downloader
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
                                            Bulk download images from page
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>
                        </CardActionArea>
                    </Card>

                    {/* Browser Utilities */}
                    <Card
                        elevation={0}
                        sx={{
                            borderRadius: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'transparent',
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }
                        }}
                    >
                        <CardActionArea onClick={() => onNavigate('utilities')} sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Box sx={{
                                        p: 1,
                                        borderRadius: 1.5,
                                        bgcolor: 'rgba(255,255,255,0.05)',
                                        color: 'text.secondary',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <Sparkles size={20} />
                                    </Box>
                                    <Box>
                                        <Typography variant="body2" fontWeight="500">
                                            Browser Utilities
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
                                            Right-click unlocker & tools
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>
                        </CardActionArea>
                    </Card>
                </Stack>
            </Box>

            {/* Footer / Recent - Fixed outside scroll */}
            <Box sx={{
                mt: 'auto',
                pt: 2,
                pb: 3,
                px: 3,
                borderTop: '1px solid',
                borderColor: 'rgba(255,255,255,0.05)',
                bgcolor: 'background.default',
                animation: 'slideUp 0.5s ease-out'
            }}>
                <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 1, display: 'block' }}>
                    Your Workspace
                </Typography>
                <Stack direction="row" spacing={1.5}>
                    <Button
                        fullWidth
                        variant="outlined"
                        color="inherit"
                        startIcon={<Clock size={16} />}
                        onClick={() => onNavigate('history')}
                        sx={{
                            justifyContent: 'center',
                            borderColor: 'divider',
                            color: 'text.secondary',
                            py: 1,
                            borderRadius: 2,
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            '&:hover': { borderColor: 'primary.main', color: 'primary.main' }
                        }}
                    >
                        Jobs
                    </Button>
                    <Button
                        fullWidth
                        variant="outlined"
                        color="inherit"
                        startIcon={<Database size={16} />}
                        onClick={() => {
                            const url = chrome.runtime.getURL('sidepanel.html?view=data-table');
                            chrome.tabs.create({ url });
                        }}
                        sx={{
                            justifyContent: 'center',
                            borderColor: 'divider',
                            color: 'text.secondary',
                            py: 1,
                            borderRadius: 2,
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            '&:hover': { borderColor: 'primary.main', color: 'primary.main' }
                        }}
                    >
                        History
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}
