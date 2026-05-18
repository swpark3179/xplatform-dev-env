import React from 'react';

type PillTone = 'accent' | 'success' | 'warning' | 'neutral';

interface PillProps {
    tone?: PillTone;
    children: React.ReactNode;
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', children }) => (
    <span className={`os-pill os-pill--${tone}`}>{children}</span>
);
