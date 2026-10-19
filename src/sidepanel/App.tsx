import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { ThemeProvider, CssBaseline, Box, Button, Typography } from '@mui/material';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createAppTheme } from './theme/muiTheme';
import { useColorMode } from './theme/colorMode';
import HomePage from './pages/HomePage';
import WelcomePage from './pages/WelcomePage';

// Every other view loads when it is opened: the data table's grid alone is ~1 MB the home screen
// never runs (docs/plans/performance-plan.md P3).
const ListExtractorPage = lazy(() => import('./pages/ListExtractorPage'));
const PageExtractorPage = lazy(() => import('./pages/PageExtractorPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ImageDownloaderPage = lazy(() => import('./pages/ImageDownloaderPage'));
const EmailExtractorPage = lazy(() => import('./pages/EmailExtractorPage'));
const UtilitiesPage = lazy(() => import('./pages/UtilitiesPage'));
const DataTablePage = lazy(() => import('./pages/DataTablePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TextSummarizerPage = lazy(() => import('./pages/TextSummarizerPage'));
const AiExtractPage = lazy(() => import('./pages/AiExtractPage'));
const ToolkitPage = lazy(() => import('./pages/ToolkitPage'));

import Header from './components/ui/Header';
import { useTabSync } from './hooks/useTabSync';

function App() {
    const [currentView, setCurrentView] = useState('home');
    const [isGlobalExtracting, setIsGlobalExtracting] = useState(false);
    const { isTabConnected, isConnecting, connectTab } = useTabSync();
    const { t } = useTranslation('common');
    const { mode } = useColorMode();
    const theme = useMemo(() => createAppTheme(mode), [mode]);


    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');
        if (view) {
            setCurrentView(view);
        }
    }, []);

    // Simple routing
    const renderView = () => {
        switch (currentView) {
            case 'list-extractor':
                return <ListExtractorPage
                    onBack={() => setCurrentView('home')}
                    onExtractionStatusChange={setIsGlobalExtracting}
                />;
            case 'page-extractor':
                return <PageExtractorPage onBack={() => setCurrentView('home')} />;
            case 'metadata-extractor':
                // Merged into "Same details from many pages": the article details, starting from this page.
                return <PageExtractorPage onBack={() => setCurrentView('home')} preset="article" />;
            case 'ai-extract':
                return <AiExtractPage onBack={() => setCurrentView('home')} />;
            case 'text-summarizer':
                return <TextSummarizerPage onBack={() => setCurrentView('home')} />;
            case 'image-downloader':
                return <ImageDownloaderPage onBack={() => setCurrentView('home')} />;
            case 'email-extractor':
                return <EmailExtractorPage onBack={() => setCurrentView('home')} />;
            case 'utilities':
                return <UtilitiesPage onBack={() => setCurrentView('home')} />;
            case 'toolkit':
                return <ToolkitPage onBack={() => setCurrentView('home')} onNavigate={setCurrentView} />;
            case 'history':
                return <HistoryPage
                    onBack={() => setCurrentView('home')}
                    onViewData={(tableId) => {
                        const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
                        chrome.tabs.create({ url });
                    }}
                />;
            case 'data-table':
                return <DataTablePage />;
            case 'settings':
                return <SettingsPage onBack={() => setCurrentView('home')} />;
            case 'welcome':
                return <WelcomePage onNavigate={setCurrentView} />;
            default:
                return <HomePage onNavigate={setCurrentView} isTabConnected={isTabConnected} />;
        }
    };



    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                {/* Global Connection Banner */}
                {!isTabConnected && currentView !== 'data-table' && (
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 2,
                        py: 1,
                        bgcolor: 'rgba(245, 158, 11, 0.08)',
                        borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
                        gap: 1.5,
                        animation: 'slideDown 0.2s ease-out',
                        '@keyframes slideDown': {
                            from: { transform: 'translateY(-100%)', opacity: 0 },
                            to: { transform: 'translateY(0)', opacity: 1 }
                        }
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{
                                width: 8, height: 8, borderRadius: '50%',
                                bgcolor: '#F59E0B',
                                animation: 'pulse 1.5s ease-in-out infinite',
                                '@keyframes pulse': {
                                    '0%, 100%': { opacity: 1 },
                                    '50%': { opacity: 0.4 }
                                }
                            }} />
                            <Box>
                                <Typography variant="caption" sx={{ color: '#F59E0B', fontWeight: 600, fontSize: '0.7rem', display: 'block' }}>
                                    {t('connection.notConnected')}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'rgba(245, 158, 11, 0.7)', fontSize: '0.6rem', display: 'block' }}>
                                    {t('connection.notConnectedHint')}
                                </Typography>
                            </Box>
                        </Box>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={connectTab}
                            disabled={isConnecting}
                            startIcon={<Zap size={12} />}
                            sx={{
                                color: '#F59E0B',
                                borderColor: 'rgba(245, 158, 11, 0.3)',
                                fontSize: '0.65rem',
                                py: 0.25,
                                px: 1.5,
                                minHeight: 24,
                                '&:hover': {
                                    borderColor: '#F59E0B',
                                    bgcolor: 'rgba(245, 158, 11, 0.1)',
                                    transform: 'none',
                                }
                            }}
                        >
                            {isConnecting ? t('connection.connecting') : t('connection.connect')}
                        </Button>
                    </Box>
                )}
                {/* Home and Welcome have the brand header; every other view has its own header with back. */}
                {(currentView === 'home' || currentView === 'welcome') && <Header onNavigate={setCurrentView} activeView={currentView} disabled={isGlobalExtracting} />}
                <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <Suspense fallback={null}>{renderView()}</Suspense>
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
