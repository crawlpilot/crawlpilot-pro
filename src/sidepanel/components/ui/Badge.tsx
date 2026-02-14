import { ReactNode } from 'react';

interface BadgeProps {
    children: ReactNode;
    variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ai';
    className?: string;
}

export default function Badge({ children, variant = 'primary', className = '' }: BadgeProps) {
    const variantMap = {
        primary: 'badge-primary',
        success: 'badge-success',
        warning: 'badge-warning',
        danger: 'badge-danger',
        info: 'badge-ai', // Map legacy info to new AI cyan
        ai: 'badge-ai'
    };

    return (
        <span className={`badge ${variantMap[variant]} ${className}`}>
            {children}
        </span>
    );
}
