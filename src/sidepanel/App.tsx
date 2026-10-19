import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { Button } from './ui';
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
const KitPage = lazy(() => import('./pages/KitPage'));

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
            case 'kit':
                return <KitPage />;
            case 'welcome':
                return <WelcomePage onNavigate={setCurrentView} />;
            default:
                return <HomePage onNavigate={setCurrentView} isTabConnected={isTabConnected} />;
        }
    };



    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <div className="flex h-screen flex-col overflow-hidden">
                {/* Global Connection Banner */}
                {!isTabConnected && currentView !== 'data-table' && (
                    <div className="flex items-center justify-between gap-3 border-b border-line bg-warning-soft px-4 py-2 animate-slide-up">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" />
                            <div className="min-w-0">
                                <p className="m-0 text-small font-semibold text-ink">{t('connection.notConnected')}</p>
                                <p className="m-0 text-caption text-ink-2">{t('connection.notConnectedHint')}</p>
                            </div>
                        </div>
                        <Button size="sm" variant="primary" icon={<Zap />} onClick={connectTab} loading={isConnecting}>
                            {isConnecting ? t('connection.connecting') : t('connection.connect')}
                        </Button>
                    </div>
                )}
                {/* Home and Welcome have the brand header; every other view has its own header with back. */}
                {(currentView === 'home' || currentView === 'welcome') && <Header onNavigate={setCurrentView} activeView={currentView} disabled={isGlobalExtracting} />}
                <div className="relative flex-1 overflow-hidden">
                    <Suspense fallback={null}>{renderView()}</Suspense>
                </div>
            </div>
        </ThemeProvider>
    );
}

export default App;
