import React from 'react';
import { AppState } from '@/hooks/useAppState';

export const BuildPanel: React.FC<{
    onBuildClasses: () => void;
    onCleanProject: () => void;
    onStopGradle: () => void;
    state: AppState;
}> = ({ onBuildClasses, onCleanProject, onStopGradle, state }) => {
    const { isGradleRunning } = state.build;
    const disabled = isGradleRunning || state.tomcat.initializing;

    return (
        <div className="os-panel">
            <div className="os-panel__head">
                <div className="os-panel__title">빌드</div>
            </div>

            {isGradleRunning && (
                <div className="os-build-status">
                    <span className="os-build-status__dot" />
                    <span className="os-build-status__text">실행 중 · <code>gradle</code></span>
                    <button className="os-build-status__cancel" type="button" onClick={onStopGradle}>중지</button>
                </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
                <button className="os-btn" type="button" onClick={onBuildClasses} disabled={disabled} style={{ flex: 1 }}>
                    빌드 (classes)
                </button>
                <button className="os-btn os-btn--secondary" type="button" onClick={onCleanProject} disabled={disabled} style={{ flex: 1 }}>
                    초기화 (clean)
                </button>
            </div>
        </div>
    );
};
