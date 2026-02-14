import { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    hover?: boolean;
    glow?: boolean;
    className?: string;
    onClick?: () => void;
}

export default function Card({ children, hover = false, glow = false, className = '', onClick, ...props }: CardProps) {
    // We ignore 'glow' prop to enforce consistency with "No flashy gradients" rule
    // 'hover' prop is kept for interactive cards but style is handled by CSS .card:hover logic if we want to add subtle lift later
    // Current CSS .card definition handles the flat look.

    return (
        <div
            className={`card ${hover ? 'hover:border-gray-600 transition-colors cursor-pointer' : ''} ${className}`}
            onClick={onClick}
            {...props}
        >
            {children}
        </div>
    );
}
