import { ArrowLeft, FileText, Sparkles, CheckCircle2, Layers } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

interface TextExtractorPageProps {
    onBack: () => void;
}

export default function TextExtractorPage({ onBack }: TextExtractorPageProps) {
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
            <Card className="mb-6 overflow-hidden border-yellow-500/20 bg-gradient-to-br from-yellow-900/20 to-orange-900/20">
                <div className="p-8">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-4 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl shadow-lg">
                            <FileText className="w-8 h-8 text-white" />
                        </div>
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold mb-1">Text Extractor</h1>
                            <p className="text-gray-400">Extract clean text content and metadata</p>
                        </div>
                        <Badge variant="warning">
                            Coming Soon
                        </Badge>
                    </div>

                    {/* Features Card */}
                    <Card className="bg-surface-darker border-gray-700">
                        <div className="p-6">
                            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-primary" />
                                Upcoming Features
                            </h3>
                            <p className="text-sm text-gray-400 mb-4">
                                This tool will intelligently extract:
                            </p>
                            <ul className="space-y-3 text-sm text-gray-400">
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                    <span>Main content text (removing ads, navigation, and clutter)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                    <span>Page metadata (title, description, keywords, author)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                    <span>Headings and document structure (H1-H6 hierarchy)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                    <span>Links and references with anchor text analysis</span>
                                </li>
                            </ul>

                            <div className="mt-6 pt-6 border-t border-gray-700">
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                    <Layers className="w-4 h-4" />
                                    <span>Export formats: Plain Text, Markdown, JSON</span>
                                </div>
                            </div>
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
