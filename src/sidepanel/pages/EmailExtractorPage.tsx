import { ArrowLeft, Mail, Sparkles, CheckCircle2 } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

interface EmailExtractorPageProps {
    onBack: () => void;
}

export default function EmailExtractorPage({ onBack }: EmailExtractorPageProps) {
    return (
        <div className="p-6 max-w-4xl mx-auto animate-fade-in">
            <Button
                onClick={onBack}
                variant="ghost"
                icon={<ArrowLeft className="w-4 h-4" />}
                className="mb-6"
            >
                Back to Home
            </Button>

            {/* Hero Card */}
            <Card className="mb-6 overflow-hidden border-green-500/20 bg-gradient-to-br from-green-900/20 to-emerald-900/20">
                <div className="p-8">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-4 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl shadow-lg">
                            <Mail className="w-8 h-8 text-white" />
                        </div>
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold mb-1">Email Extractor</h1>
                            <p className="text-gray-400">Find and extract email addresses with precision</p>
                        </div>
                        <Badge variant="warning">
                            Coming Soon
                        </Badge>
                    </div>

                    {/* Features Card */}
                    <Card className="bg-surface-darker border-gray-700">
                        <div className="p-6">
                            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-accent-green" />
                                Upcoming Features
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                This powerful tool will automatically:
                            </p>
                            <ul className="space-y-3 text-sm text-gray-400">
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" />
                                    <span>Scan current page for email addresses using advanced regex</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" />
                                    <span>Extract from multiple pages in bulk with pagination support</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" />
                                    <span>Remove duplicates automatically and export as CSV</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" />
                                    <span>Validate email format and filter by domain</span>
                                </li>
                            </ul>
                        </div>
                    </Card>
                </div>
            </Card>

            {/* Info Card */}
            <Card className="border-gray-800 mb-6">
                <div className="p-6 text-center">
                    <div className="text-4xl mb-3">🚧</div>
                    <h3 className="text-lg font-semibold mb-2">Under Development</h3>
                    <p className="text-sm text-gray-400">
                        We're working hard to bring you this feature. Check back soon for updates!
                    </p>
                </div>
            </Card>
        </div>
    );
}
