import React from 'react';

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    ErrorBoundaryState
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '16px', color: '#ff6b6b', fontFamily: 'monospace', fontSize: '13px' }}>
                    <h3 style={{ color: '#ff6b6b' }}>⚠ 렌더링 오류 발생</h3>
                    <pre style={{ 
                        whiteSpace: 'pre-wrap', 
                        wordBreak: 'break-all', 
                        background: 'rgba(255,0,0,0.1)', 
                        padding: '8px', 
                        borderRadius: '4px' 
                    }}>
                        {this.state.error?.message}
                        {'\n\n'}
                        {this.state.error?.stack}
                    </pre>
                </div>
            );
        }
        return this.props.children;
    }
}
