import { useState, useEffect } from 'react';
import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import { muiTheme } from './theme/muiTheme';
import HomePage from './pages/HomePage';
import ListExtractorPage from './pages/ListExtractorPage';
import PageExtractorPage from './pages/PageExtractorPage';
import HistoryPage from './pages/HistoryPage';
import ImageDownloaderPage from './pages/ImageDownloaderPage';
import EmailExtractorPage from './pages/EmailExtractorPage';
import UtilitiesPage from './pages/UtilitiesPage';
import DataTablePage from './pages/DataTablePage'; // Assuming this import exists or I will create it
import SettingsPage from './pages/SettingsPage';
import TextSummarizerPage from './pages/TextSummarizerPage';
import Header from './components/ui/Header';

function App() {
    const [currentView, setCurrentView] = useState('home');
    const [isGlobalExtracting, setIsGlobalExtracting] = useState(false);

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
            case 'text-summarizer':
                return <TextSummarizerPage onBack={() => setCurrentView('home')} />;
            case 'image-downloader':
                return <ImageDownloaderPage onBack={() => setCurrentView('home')} />;
            case 'email-extractor':
                return <EmailExtractorPage onBack={() => setCurrentView('home')} />;
            case 'utilities':
                return <UtilitiesPage onBack={() => setCurrentView('home')} />;
            case 'history':
                return <HistoryPage
                    onBack={() => setCurrentView('home')}
                    onViewData={(tableId) => {
                        const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`);
                        chrome.tabs.create({ url });
                    }}
                />;
            case 'data-table':
                return <DataTablePage />;
            case 'settings':
                return <SettingsPage onBack={() => setCurrentView('home')} />;
            default:
                return <HomePage onNavigate={setCurrentView} />;
        }
    };

    return (
        <ThemeProvider theme={muiTheme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                {currentView !== 'data-table' && <Header onNavigate={setCurrentView} activeView={currentView} disabled={isGlobalExtracting} />}
                <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {renderView()}
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
