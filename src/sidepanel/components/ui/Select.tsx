import type { ReactNode } from 'react';

interface SelectProps {
    value: string | number;
    onChange: (value: string) => void;
    children: ReactNode;
    className?: string;
}

export default function Select({ value, onChange, children, className = '' }: SelectProps) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`px-3 py-2 bg-background-card border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-accent-ai ${className}`}
        >
            {children}
        </select>
    );
}
