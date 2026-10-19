import { ReactNode } from 'react';
import { TextField, InputAdornment, TextFieldProps } from '@mui/material';

interface InputProps extends Omit<TextFieldProps, 'variant'> {
    label?: string;
    icon?: ReactNode;
    helperText?: string;
}

export default function Input({
    label,
    icon,
    helperText,
    error,
    InputProps,
    className,
    ...props
}: InputProps) {
    return (
        <TextField
            label={label}
            fullWidth
            variant="outlined"
            size="small"
            error={!!error}
            helperText={error || helperText}
            className={className}
            InputProps={{
                startAdornment: icon ? (
                    <InputAdornment position="start" sx={{ color: 'text.secondary' }}>{icon}</InputAdornment>
                ) : null,
                ...InputProps,
            }}
            sx={{
                '& .MuiOutlinedInput-root': {
                    bgcolor: 'background.paper',
                    '& fieldset': {
                        borderColor: 'rgb(var(--cp-ink-rgb) / 0.12)',
                    },
                    '&:hover fieldset': {
                        borderColor: 'rgb(var(--cp-ink-rgb) / 0.3)',
                    },
                }
            }}
            {...props}
        />
    );
}
