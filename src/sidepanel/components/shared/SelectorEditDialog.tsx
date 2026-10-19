import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    IconButton,
    Typography,
    Box,
    TextField,
    Select,
    MenuItem,
    Stack,
    Paper,
    styled,
    Tooltip
} from '@mui/material';
import { X, Plus, Check, Play, Trash2, GripVertical, Settings2 } from 'lucide-react';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import { selectorFamily } from '../../../shared/selectors/grade';

const StyledDialog = styled(Dialog)(() => ({
    '& .MuiDialog-paper': {
        borderRadius: '20px',
        backgroundColor: '#0f172a',
        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        maxWidth: '600px',
        width: '100%'
    }
}));

const SelectorItemRow = styled(Paper)(() => ({
    padding: '16px',
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '12px',
    transition: 'all 0.2s',
    '&:hover': {
        border: '1px solid rgba(6, 182, 212, 0.3)',
        backgroundColor: 'rgba(2, 6, 23, 0.8)'
    }
}));

interface SelectorEditDialogProps {
    isOpen: boolean;
    title: string;
    /** The chain, best first. */
    selectors: string[];
    onSave: (selectors: string[]) => void;
    onCancel: () => void;
    onVerify: (selector: string) => void;
}

interface SelectorItem {
    id: string;
    value: string;
    type: 'CSS' | 'XPath';
}

export const SelectorEditDialog: React.FC<SelectorEditDialogProps> = ({
    isOpen,
    title,
    selectors: initialSelectors,
    onSave,
    onCancel,
    onVerify
}) => {
    const [selectors, setSelectors] = useState<SelectorItem[]>([]);

    useEffect(() => {
        if (isOpen) {
            const items: SelectorItem[] = (initialSelectors.length > 0 ? initialSelectors : ['']).map((s, i) => ({
                id: `sel-${Date.now()}-${i}`,
                value: s,
                type: looksLikeXPath(s) ? 'XPath' : 'CSS',
            }));
            setSelectors(items);
        }
    }, [isOpen, initialSelectors]);

    const handleAdd = () => {
        setSelectors([...selectors, { id: `sel-${Date.now()}`, value: '', type: 'CSS' }]);
    };

    const handleRemove = (id: string) => {
        setSelectors(selectors.filter(s => s.id !== id));
    };

    const handleChange = (id: string, newValue: string) => {
        setSelectors(selectors.map(s => {
            if (s.id === id) {
                const isXPath = typeof newValue === 'string' && looksLikeXPath(newValue);
                const newType = isXPath ? 'XPath' : 'CSS';
                return { ...s, value: newValue, type: newType };
            }
            return s;
        }));
    };

    const handleTypeChange = (id: string, newType: 'CSS' | 'XPath') => {
        setSelectors(selectors.map(s => s.id === id ? { ...s, type: newType } : s));
    };

    const handleSave = () => {
        onSave(selectors.map(s => s.value.trim()).filter(Boolean));
    };

    return (
        <StyledDialog open={isOpen} onClose={onCancel} maxWidth="sm" fullWidth>
            <DialogTitle sx={{
                p: 3,
                pb: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{
                        p: 1,
                        borderRadius: '10px',
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        display: 'flex'
                    }}>
                        <Settings2 size={18} />
                    </Box>
                    <Box>
                        <Typography variant="h6" sx={{ color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                            {title}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.4)', fontWeight: 500 }}>
                            Configuration for structural data detection
                        </Typography>
                    </Box>
                </Box>
                <IconButton onClick={onCancel} size="small" sx={{ color: 'rgba(255, 255, 255, 0.3)' }}>
                    <X size={20} />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ p: 3, mt: 1 }}>
                <Stack spacing={2}>
                    {selectors.map((sel, index) => (
                        <SelectorItemRow key={sel.id} elevation={0}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <GripVertical size={14} className="text-slate-600" />
                                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Selector {index + 1}
                                    </Typography>
                                    {sel.value.trim() && (
                                        <Box sx={{
                                            px: 1,
                                            py: 0.25,
                                            borderRadius: '4px',
                                            bgcolor: 'rgba(6, 182, 212, 0.1)',
                                            border: '1px solid rgba(6, 182, 212, 0.2)',
                                            color: '#06b6d4',
                                            fontSize: '9px',
                                            fontWeight: 800,
                                            textTransform: 'uppercase'
                                        }}>
                                            {selectorFamily(sel.value.trim())}
                                        </Box>
                                    )}
                                </Box>
                                <IconButton
                                    size="small"
                                    onClick={() => handleRemove(sel.id)}
                                    sx={{
                                        color: 'rgba(239, 68, 68, 0.4)',
                                        '&:hover': { color: '#ef4444', bgcolor: 'rgba(239, 68, 68, 0.1)' }
                                    }}
                                >
                                    <Trash2 size={14} />
                                </IconButton>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <Select
                                    size="small"
                                    value={sel.type}
                                    onChange={(e) => handleTypeChange(sel.id, e.target.value as 'CSS' | 'XPath')}
                                    sx={{
                                        minWidth: '90px',
                                        bgcolor: 'rgba(0, 0, 0, 0.2)',
                                        borderRadius: '8px',
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.1)' }
                                    }}
                                >
                                    <MenuItem value="CSS" sx={{ fontSize: '0.75rem' }}>CSS</MenuItem>
                                    <MenuItem value="XPath" sx={{ fontSize: '0.75rem' }}>XPath</MenuItem>
                                </Select>

                                <TextField
                                    fullWidth
                                    size="small"
                                    value={sel.value}
                                    onChange={(e) => handleChange(sel.id, e.target.value)}
                                    placeholder={sel.type === 'CSS' ? ".class-name" : "//div[@id='foo']"}
                                    variant="outlined"
                                    InputProps={{
                                        sx: {
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem',
                                            bgcolor: 'rgba(0, 0, 0, 0.2)',
                                            borderRadius: '8px',
                                            color: 'cyan.100'
                                        }
                                    }}
                                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.1)' } }}
                                />

                                <Tooltip title="Verify on page">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => onVerify(sel.value)}
                                        sx={{
                                            minWidth: '40px',
                                            borderRadius: '8px',
                                            borderColor: 'rgba(255, 255, 255, 0.1)',
                                            color: 'rgba(255, 255, 255, 0.5)',
                                            '&:hover': { borderColor: 'primary.main', color: 'primary.main' }
                                        }}
                                    >
                                        <Play size={14} />
                                    </Button>
                                </Tooltip>
                            </Box>
                        </SelectorItemRow>
                    ))}

                    <Button
                        fullWidth
                        variant="outlined"
                        onClick={handleAdd}
                        startIcon={<Plus size={16} />}
                        sx={{
                            py: 1.5,
                            borderStyle: 'dashed',
                            borderRadius: '12px',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            color: 'rgba(255, 255, 255, 0.4)',
                            textTransform: 'none',
                            fontWeight: 600,
                            '&:hover': {
                                borderColor: 'primary.main',
                                bgcolor: 'rgba(6, 182, 212, 0.05)',
                                color: 'primary.main'
                            }
                        }}
                    >
                        Add alternative selector
                    </Button>
                </Stack>
            </DialogContent>

            <DialogActions sx={{ p: 3, pt: 1, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <Button
                    onClick={onCancel}
                    sx={{ color: 'rgba(255, 255, 255, 0.5)', textTransform: 'none', fontWeight: 600 }}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    startIcon={<Check size={18} />}
                    sx={{
                        borderRadius: '10px',
                        px: 3,
                        py: 1,
                        textTransform: 'none',
                        fontWeight: 700,
                        background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                        boxShadow: '0 10px 20px -5px rgba(6, 182, 212, 0.3)'
                    }}
                >
                    Apply Changes
                </Button>
            </DialogActions>
        </StyledDialog>
    );
};
