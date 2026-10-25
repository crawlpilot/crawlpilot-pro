import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog } from '../../../ui';

/** A markdown cell's content in a modal. */
export function MarkdownPreview({ preview, onClose }: { preview: { content: string; title: string }; onClose: () => void }) {
    const { t } = useTranslation('dataTable');
    return (
        <Dialog open onClose={onClose} size="lg" title={preview.title} closeLabel={t('preview.close')}>
            <div className="space-y-3 text-body leading-relaxed text-ink">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            h1: ({ children }) => <h1 className="text-xl font-bold text-ink mt-5 mb-2 border-b border-line pb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-semibold text-ink mt-4 mb-1.5">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-semibold text-ink mt-3 mb-1">{children}</h3>,
                            h4: ({ children }) => <h4 className="text-sm font-medium text-ink mt-2 mb-0.5">{children}</h4>,
                            p: ({ children }) => <p className="text-ink leading-relaxed mb-3">{children}</p>,
                            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-brand decoration-2 underline-offset-2 hover:bg-brand/30">{children}</a>,
                            strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
                            em: ({ children }) => <em className="italic text-ink">{children}</em>,
                            code: ({ children, className }) => {
                                const isBlock = className?.includes('language-');
                                return isBlock
                                    ? <code className="block bg-ink/[0.06] border border-line rounded-md px-4 py-3 text-[12px] font-mono text-ink overflow-x-auto whitespace-pre my-2">{children}</code>
                                    : <code className="bg-ink/[0.06] rounded px-1.5 py-0.5 text-[11px] font-mono text-ink border border-line">{children}</code>;
                            },
                            pre: ({ children }) => <pre className="my-2">{children}</pre>,
                            blockquote: ({ children }) => <blockquote className="border-l-2 border-brand pl-4 my-3 text-ink-2 italic">{children}</blockquote>,
                            ul: ({ children }) => <ul className="list-disc list-outside pl-5 space-y-0.5 mb-3 text-ink">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-outside pl-5 space-y-0.5 mb-3 text-ink">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                            hr: () => <hr className="border-line my-4" />,
                            table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-xs border-collapse border border-line">{children}</table></div>,
                            thead: ({ children }) => <thead className="bg-ink/5">{children}</thead>,
                            th: ({ children }) => <th className="border border-line px-3 py-1.5 text-left font-semibold text-ink">{children}</th>,
                            td: ({ children }) => <td className="border border-line px-3 py-1.5 text-ink">{children}</td>,
                            img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full rounded-lg my-2 border border-line" loading="lazy" />,
                        }}
                    >
                        {preview.content}
                    </ReactMarkdown>
            </div>
        </Dialog>
    );
}
