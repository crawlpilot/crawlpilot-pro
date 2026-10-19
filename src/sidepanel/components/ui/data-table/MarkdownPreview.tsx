import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, X } from 'lucide-react';

/** A markdown cell's content in a modal. */
export function MarkdownPreview({ preview, onClose }: { preview: { content: string; title: string }; onClose: () => void }) {
    const { t } = useTranslation('dataTable');
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => onClose()}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        >
            <div
                className="relative bg-[#0f172a] border border-ink/10 rounded-xl shadow-2xl w-full max-w-2xl max-h-[78vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10 shrink-0 bg-ink/[0.03] rounded-t-xl">
                    <div className="flex items-center gap-2">
                        <FileText size={13} className="text-primary shrink-0" />
                        <span className="text-sm font-semibold text-text-primary truncate">{preview.title}</span>
                    </div>
                    <button
                        onClick={() => onClose()}
                        className="p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-ink/10 transition-colors"
                        aria-label={t('preview.close')}
                    >
                        <X size={15} />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto px-6 py-5 text-sm text-[#cbd5e1] leading-relaxed space-y-3">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            h1: ({ children }) => <h1 className="text-xl font-bold text-text-primary mt-5 mb-2 border-b border-ink/10 pb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-semibold text-text-primary mt-4 mb-1.5">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-200 mt-3 mb-1">{children}</h3>,
                            h4: ({ children }) => <h4 className="text-sm font-medium text-slate-300 mt-2 mb-0.5">{children}</h4>,
                            p: ({ children }) => <p className="text-slate-300 leading-relaxed mb-3">{children}</p>,
                            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-400/40 transition-colors">{children}</a>,
                            strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
                            em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
                            code: ({ children, className }) => {
                                const isBlock = className?.includes('language-');
                                return isBlock
                                    ? <code className="block bg-slate-800/80 border border-ink/10 rounded-md px-4 py-3 text-[12px] font-mono text-emerald-300 overflow-x-auto whitespace-pre my-2">{children}</code>
                                    : <code className="bg-slate-800 rounded px-1.5 py-0.5 text-[11px] font-mono text-emerald-300 border border-ink/10">{children}</code>;
                            },
                            pre: ({ children }) => <pre className="my-2">{children}</pre>,
                            blockquote: ({ children }) => <blockquote className="border-l-2 border-primary pl-4 my-3 text-slate-400 italic">{children}</blockquote>,
                            ul: ({ children }) => <ul className="list-disc list-outside pl-5 space-y-0.5 mb-3 text-slate-300">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-outside pl-5 space-y-0.5 mb-3 text-slate-300">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                            hr: () => <hr className="border-ink/10 my-4" />,
                            table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-xs border-collapse border border-ink/10">{children}</table></div>,
                            thead: ({ children }) => <thead className="bg-ink/5">{children}</thead>,
                            th: ({ children }) => <th className="border border-ink/10 px-3 py-1.5 text-left font-semibold text-slate-200">{children}</th>,
                            td: ({ children }) => <td className="border border-ink/10 px-3 py-1.5 text-slate-300">{children}</td>,
                            img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full rounded-lg my-2 border border-ink/10" loading="lazy" />,
                        }}
                    >
                        {preview.content}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
