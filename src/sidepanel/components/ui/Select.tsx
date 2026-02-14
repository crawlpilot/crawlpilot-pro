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
            className={`px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 ${className}`}
        >
            {children}
        </select>
    );
}
