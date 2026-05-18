import React from 'react';

export interface StepDef {
    n: number;
    label: string;
}

interface Props {
    steps: StepDef[];
    active: number;
    completed: number[];
    onJump?: (n: number) => void;
}

export const StepperHeader: React.FC<Props> = ({ steps, active, completed, onJump }) => (
    <div className="os-steps">
        {steps.map((s, i) => {
            const isDone = completed.includes(s.n);
            const isActive = active === s.n;
            const state = isActive ? 'active' : isDone ? 'done' : 'todo';
            const clickable = isDone || isActive;
            return (
                <React.Fragment key={s.n}>
                    <button
                        type="button"
                        className={`os-step os-step--${state}`}
                        onClick={() => clickable && onJump?.(s.n)}
                        disabled={!clickable}
                    >
                        <span className="os-step__dot">{isDone ? '✓' : s.n}</span>
                        <span className="os-step__label">{s.label}</span>
                    </button>
                    {i < steps.length - 1 && (
                        <span className={`os-step__bar${isDone ? ' os-step__bar--done' : ''}`} />
                    )}
                </React.Fragment>
            );
        })}
    </div>
);
