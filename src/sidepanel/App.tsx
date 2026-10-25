import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Button } from './ui';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useColorMode } from './theme/colorMode';
import HomePage from './pages/HomePage';

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
const TablesPage = lazy(() => import('./pages/TablesPage'));
const MarkdownPage = lazy(() => import('./pages/MarkdownPage'));
const KitPage = lazy(() => import('./pages/KitPage'));
const ProRecipesPage = lazy(() => import('../pro/pages/RecipesPage'));
const ProHistoryPage = lazy(() => import('../pro/pages/HistoryPage'));
const ProEditorPage = lazy(() => import('../pro/pages/EditorPage'));

import Header from './components/ui/Header';
import { useTabSync } from './hooks/useTabSync';
import { useListRunStatus } from './hooks/useExtractionProcess';

function App() {
    // Pro opens on its Recipes screen; Build new goes to the public tools on Home.
    const [currentView, setCurrentView] = useState('pro-recipes');
    // The screens that led here: Back returns to the one before (Toolkit → Page Extractor → Toolkit), Home when none.
    const [trail, setTrail] = useState<string[]>([]);
    const navigate = useCallback((view: string) => {
        if (view === currentView) return;
        // Home, or a screen already on the trail, cuts the trail back to it: no loops of Back.
        const at = trail.indexOf(view);
        setTrail(view === 'home' ? [] : at >= 0 ? trail.slice(0, at) : [...trail, currentView]);
        setCurrentView(view);
    }, [currentView, trail]);
    const goBack = useCallback(() => {
        setCurrentView(trail[trail.length - 1] ?? 'home');
        setTrail(trail.slice(0, -1));
    }, [trail]);
    const isGlobalExtracting = useListRunStatus().isExtracting;
    const { isTabConnected, isConnecting, connectTab } = useTabSync();
    const { t } = useTranslation('common');
    useColorMode();


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
                return <ListExtractorPage onBack={goBack} onNavigate={navigate} />;
            case 'page-extractor':
                return <PageExtractorPage onBack={goBack} onNavigate={navigate} />;
            case 'product-details':
                // Home's product suggestion: straight to picking this page's fields.
                return <PageExtractorPage onBack={goBack} preset="fields" onNavigate={navigate} />;
            case 'metadata-extractor':
                // Merged into "Same details from many pages": the article details, starting from this page.
                return <PageExtractorPage onBack={goBack} preset="article" />;
            case 'ai-extract':
                return <AiExtractPage onBack={goBack} />;
            case 'text-summarizer':
                return <TextSummarizerPage onBack={goBack} onNavigate={navigate} />;
            case 'image-downloader':
                return <ImageDownloaderPage onBack={goBack} />;
            case 'email-extractor':
                return <EmailExtractorPage onBack={goBack} />;
            case 'utilities':
                return <UtilitiesPage onBack={goBack} />;
            case 'tables':
                return <TablesPage onBack={goBack} onNavigate={navigate} />;
            case 'markdown':
                return <MarkdownPage onBack={goBack} />;
            case 'toolkit':
                return <ToolkitPage onBack={goBack} onNavigate={navigate} />;
            case 'history':
                return <HistoryPage
                    onBack={goBack}
                    onViewData={(tableId) => {
                        const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
                        chrome.tabs.create({ url });
                    }}
                />;
            case 'data-table':
                return <DataTablePage />;
            case 'settings':
                return <SettingsPage onBack={goBack} />;
            case 'kit':
                return <KitPage />;
            case 'pro-recipes':
                return <ProRecipesPage onNavigate={navigate} />;
            case 'pro-history':
                return <ProHistoryPage onBack={goBack} onNavigate={navigate} />;
            case 'pro-editor':
                return <ProEditorPage onBack={goBack} onNavigate={navigate} />;
            default:
                return <HomePage onNavigate={navigate} isTabConnected={isTabConnected} />;
        }
    };



    return (
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
                {/* Home has the brand header; every other view has its own header with back. */}
                {currentView === 'home' && <Header onNavigate={navigate} activeView={currentView} disabled={isGlobalExtracting} />}
                <div className="relative flex-1 overflow-hidden">
                    <Suspense fallback={null}>{renderView()}</Suspense>
                </div>
            </div>
    );
}

export default App;
