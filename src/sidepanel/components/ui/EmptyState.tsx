import { ReactNode } from 'react';

interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center animate-fade-in w-full">
            {icon && (
                <div className="mb-4 text-text-muted opacity-50 flex items-center justify-center">
                    {/* If icon is a string (emoji), render as text, else as element */}
                    {typeof icon === 'string' ? <span className="text-4xl">{icon}</span> : icon}
                </div>
            )}
            <h3 className="text-sm font-semibold text-text-primary mb-1">
                {title}
            </h3>
            {description && (
                <p className="text-sm text-text-muted mb-5 max-w-xs">
                    {description}
                </p>
            )}
            {action && (
                <div className="mt-2">
                    {action}
                </div>
            )}
        </div>
    );
}
