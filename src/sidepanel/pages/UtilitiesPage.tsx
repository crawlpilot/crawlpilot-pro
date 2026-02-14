import { ArrowLeft, Unlock, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

interface UtilitiesPageProps {
    onBack: () => void;
}

export default function UtilitiesPage({ onBack }: UtilitiesPageProps) {
    const [rightClickEnabled, setRightClickEnabled] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Here we could check initial state if we persisted it, 
        // for now it resets per session or we can query the content script state.
        // checkState(); 
    }, []);

    const toggleRightClick = async () => {
        setLoading(true);
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const newState = !rightClickEnabled;
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'toggle_right_click',
                    payload: { enable: newState }
                });
                if (response && response.success) {
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
        <div className="p-6 max-w-4xl mx-auto animate-fade-in">
            <Button
                onClick={onBack}
                variant="ghost"
                size="small"
                icon={<ArrowLeft className="w-4 h-4" />}
                className="mb-6"
            >
                Back to Home
            </Button>

            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Browser Utilities</h1>
                <p className="text-gray-400">Tools to enhance your browsing experience</p>
            </div>

            <div className="grid gap-4">
                <Card className="p-6 border-slate-700 bg-slate-800/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${rightClickEnabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-400'}`}>
                                <Unlock size={24} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg flex items-center gap-2">
                                    Right-Click Unlocker
                                    {rightClickEnabled && <Badge variant="success">Active</Badge>}
                                </h3>
                                <p className="text-sm text-gray-400">
                                    Re-enable context menu, copy, paste, and text selection on restricted sites.
                                </p>
                            </div>
                        </div>
                        <Button
                            variant={rightClickEnabled ? 'primary' : 'secondary'}
                            onClick={toggleRightClick}
                            disabled={loading}
                        >
                            {rightClickEnabled ? 'Enabled' : 'Enable'}
                        </Button>
                    </div>
                </Card>

                {/* Placeholder for future utils */}
                <Card className="p-6 border-slate-700 bg-slate-800/20 opacity-75">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-slate-700/30 text-slate-500">
                            <AlertTriangle size={24} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg text-slate-500">More Tools Coming Soon</h3>
                            <p className="text-sm text-gray-500">
                                Additional utilities will be available in future updates.
                            </p>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
