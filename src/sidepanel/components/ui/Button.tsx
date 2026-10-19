import { ReactNode } from 'react';
import { Button as MuiButton, ButtonProps as MuiButtonProps, CircularProgress, alpha } from '@mui/material';

interface ButtonProps extends Omit<MuiButtonProps, 'variant'> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    loading?: boolean;
    icon?: ReactNode;
}

export default function Button({
    children,
    variant = 'primary',
    loading = false,
    icon,
    disabled,
    sx,
    className,
    ...props
}: ButtonProps) {
    let muiVariant: MuiButtonProps['variant'] = 'contained';
    let color: MuiButtonProps['color'] = 'primary';
    let customSx = {};

    if (variant === 'secondary') {
        muiVariant = 'outlined';
        color = 'primary';
        customSx = {
            borderColor: 'rgb(var(--cp-ink-rgb) / 0.2)',
            color: 'text.primary',
            '&:hover': {
                borderColor: 'primary.main',
                bgcolor: alpha('#2563EB', 0.04)
            }
        };
    } else if (variant === 'ghost') {
        muiVariant = 'text';
        color = 'inherit';
        customSx = {
            color: 'text.secondary',
            '&:hover': { color: 'text.primary', bgcolor: 'rgb(var(--cp-ink-rgb) / 0.04)' }
        };
    } else if (variant === 'danger') {
        muiVariant = 'outlined';
        color = 'error';
    }

    return (
        <MuiButton
            variant={muiVariant}
            color={color}
            disabled={disabled || loading}
            startIcon={!loading ? icon : undefined}
            endIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
            className={className}
            sx={{
                textTransform: 'none',
                boxShadow: 'none',
                fontWeight: 500,
                ...customSx,
                ...sx
            }}
            {...props}
        >
            {children}
        </MuiButton>
    );
}
