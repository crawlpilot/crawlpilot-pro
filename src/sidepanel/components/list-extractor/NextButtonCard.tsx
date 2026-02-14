import { Edit, MousePointer2, RefreshCw, Trash2, CheckCircle2 } from 'lucide-react';
import { SelectorMetadata } from '../../../shared/types/extraction';
import { Box, Card, Typography, Button, IconButton, Stack, Chip } from '@mui/material';

interface NextButtonCardProps {
    selector: string;
    metadata: SelectorMetadata[];
    title: string;
    onRemove: () => void;
    onTest: (selector: string) => void;
    onEdit: () => void;
}

export function NextButtonCard({ selector, metadata, title, onRemove, onTest, onEdit }: NextButtonCardProps) {
    const strategy = metadata?.[0]?.strategy || 'Manual';

    return (
        <Card
            variant="outlined"
            sx={{
                p: 2,
                borderRadius: 3,
                borderColor: 'primary.main',
                bgcolor: 'rgba(37, 99, 235, 0.05)',
                position: 'relative'
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{
                        p: 0.75,
                        borderRadius: 1,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <MousePointer2 size={16} />
                    </Box>
                    <Box>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="subtitle2" fontWeight="600" color="primary.main">
                                {title} Selected
                            </Typography>
                            <Chip
                                label={strategy}
                                size="small"
                                color="primary"
                                variant="outlined"
                                sx={{ height: 16, fontSize: '0.65rem', px: 0.5 }}
                            />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CheckCircle2 size={12} className="text-green-500" />
                            Ready
                        </Typography>
                    </Box>
                </Box>
                <Stack direction="row" spacing={0.5}>
                    <IconButton onClick={onEdit} size="small" sx={{ color: 'text.secondary' }}>
                        <Edit size={16} />
                    </IconButton>
                    <IconButton onClick={onRemove} size="small" color="error">
                        <Trash2 size={16} />
                    </IconButton>
                </Stack>
            </Box>

            <Box sx={{
                bgcolor: 'background.paper',
                p: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                mb: 2
            }}>
                <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                    {selector}
                </Typography>
            </Box>

            <Button
                variant="outlined"
                fullWidth
                size="small"
                startIcon={<RefreshCw size={14} />}
                onClick={() => onTest(selector)}
                sx={{
                    borderColor: 'divider',
                    color: 'text.secondary',
                    '&:hover': {
                        borderColor: 'primary.main',
                        color: 'primary.main',
                        bgcolor: 'rgba(37, 99, 235, 0.05)'
                    }
                }}
            >
                Test Selector
            </Button>
        </Card>
    );
}
