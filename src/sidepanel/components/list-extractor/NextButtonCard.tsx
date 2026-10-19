import { Edit, MousePointer2, RefreshCw, Trash2, CheckCircle2 } from 'lucide-react';
import { selectorFamily } from '../../../shared/selectors/grade';
import { Button, Card, Chip, IconButton, Row, Text } from '../../ui';

interface NextButtonCardProps {
    /** The control's chain, best first. */
    chain: string[];
    title: string;
    onRemove: () => void;
    onTest: (selector: string) => void;
    onEdit: () => void;
}

export function NextButtonCard({ chain, title, onRemove, onTest, onEdit }: NextButtonCardProps) {
    const selector = chain[0] ?? '';
    const strategy = `${selectorFamily(selector)}${chain.length > 1 ? ` +${chain.length - 1}` : ''}`;

    return (
        <Card raised>
            <Row justify="between" align="start" className="mb-3">
                <Row gap={2.5} className="min-w-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-line-strong bg-brand text-on-brand"><MousePointer2 size={16} /></span>
                    <div className="min-w-0">
                        <Row gap={1.5}>
                            <Text weight="semibold">{title} selected</Text>
                            <Chip tone="outline">{strategy}</Chip>
                        </Row>
                        <Text size="caption" tone="success" className="flex items-center gap-1"><CheckCircle2 size={12} /> Ready</Text>
                    </div>
                </Row>
                <Row gap={0.5} className="-mr-1.5 shrink-0">
                    <IconButton size="sm" label="Edit" onClick={onEdit}><Edit /></IconButton>
                    <IconButton size="sm" label="Remove" variant="danger" className="border-0" onClick={onRemove}><Trash2 /></IconButton>
                </Row>
            </Row>
            <div className="mb-3 rounded-field bg-surface-2 px-3 py-2 font-mono text-caption break-all text-ink-2">{selector}</div>
            <Button size="sm" fullWidth icon={<RefreshCw />} onClick={() => onTest(selector)}>Test selector</Button>
        </Card>
    );
}
