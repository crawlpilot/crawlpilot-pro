import React, { Component, ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { Button, Notice } from '../ui';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen items-center justify-center bg-bg p-6">
                    <Notice tone="danger" title="Something went wrong" className="w-full max-w-md"
                        action={<Button size="sm" variant="primary" icon={<RotateCw />} onClick={() => window.location.reload()}>Reload</Button>}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </Notice>
                </div>
            );
        }

        return this.props.children;
    }
}
