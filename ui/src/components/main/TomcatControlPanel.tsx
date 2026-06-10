import React, { useState } from 'react';
import { AppActions, AppState } from '@/hooks/useAppState';
import { ChangedFilesModal } from './ChangedFilesModal';

export const TomcatControlPanel: React.FC<{ state: AppState, actions: AppActions }> = ({ state, actions }) => {
    const [isChangedFilesOpen, setIsChangedFilesOpen] = useState(false);
    const [debugMode, setDebugMode] = useState(false);

    const getStatusText = () => {
        if (state.tomcat.stopping) return '중지중';
        if (state.tomcat.starting && state.tomcat.debugMode) return '기동중 (디버깅)';
        if (state.tomcat.starting) return '기동중';
        if (!state.tomcat.running) return '중지됨';
        if (state.tomcat.debugMode) return '실행 중 (디버깅)';
        return '실행 중';
    };

    const statusVariant = state.tomcat.stopping || state.tomcat.starting
        ? 'starting'
        : state.tomcat.running
            ? 'running'
            : '';

    const isTransitioning = state.tomcat.starting || state.tomcat.stopping;
    const notInitialized = !state.tomcat.initialized; // .tomcat/.classpath/.project 미생성 (초기화 필요)
    const startDisabled = notInitialized || state.tomcat.running || state.tomcat.initializing || state.build.isGradleRunning || isTransitioning;
    const stopDisabled = (!state.tomcat.running && !state.tomcat.stopping) || state.tomcat.initializing || state.build.isGradleRunning || state.tomcat.stopping;

    if (state.tomcat.portsBlocked) {
        return (
            <div className="os-panel">
                <div className="os-panel__head">
                    <div className="os-panel__title">Tomcat 서버 제어</div>
                </div>
                <div className="os-panel__sub">
                    7001 또는 12001 포트가 사용 중입니다. 포트를 종료하면 정상적으로 Tomcat을 사용할 수 있습니다.
                </div>
                <button className="os-btn" type="button" onClick={actions.tomcat.killTomcatPorts}>
                    포트 종료
                </button>
            </div>
        );
    }

    const hotReloadEnabled = state.tomcat.isHotReloadMode && state.validation.jdk_has_dcevm;
    const changedCount = state.deploy.changedFiles.java.length + state.deploy.changedFiles.query.length;

    const handleStart = () => {
        if (debugMode) {
            actions.tomcat.debugTomcat(hotReloadEnabled);
        } else {
            actions.tomcat.startTomcat(hotReloadEnabled);
        }
    };

    return (
        <div className="os-panel">
            <div className="os-panel__head">
                <div className="os-panel__title">Tomcat 서버 제어</div>
                <div className={`os-tom-status${statusVariant ? ` os-tom-status--${statusVariant}` : ''}`}>
                    <span className="os-tom-status__dot" />
                    <span>{getStatusText()}</span>
                </div>
            </div>

            <label
                className="os-switch-row"
                onClick={() => {
                    if (!state.tomcat.running && state.validation.jdk_has_dcevm) {
                        actions.tomcat.setStateIsHotReloading(!state.tomcat.isHotReloadMode);
                    }
                }}
                style={{ opacity: state.validation.jdk_has_dcevm ? 1 : 0.5 }}
            >
                <span className={`os-switch ${hotReloadEnabled ? 'os-switch--on' : ''}`} />
                <div className="os-switch-row__text">
                    <span style={{ fontWeight: 500 }}>Hot Reloading</span>
                </div>
            </label>

            <div className="os-tom-row">
                {!state.tomcat.running && !state.tomcat.stopping ? (
                    <>
                        <button
                            className="os-tom-row__btn"
                            type="button"
                            onClick={handleStart}
                            disabled={startDisabled}
                            title={notInitialized ? '프로젝트 초기화가 필요합니다 (Tomcat 초기화 및 프로젝트 설정 적용)' : undefined}
                        >
                            ▶ {state.tomcat.starting ? '기동중…' : '시작'}
                        </button>
                        <label className="os-tom-debug" onClick={() => setDebugMode(!debugMode)}>
                            <span className={`os-switch ${debugMode ? 'os-switch--on' : ''}`} />
                            <span className="os-tom-debug__label">디버그</span>
                        </label>
                    </>
                ) : (
                    <>
                        <button
                            className="os-tom-row__btn os-tom-row__btn--stop"
                            type="button"
                            onClick={actions.tomcat.stopTomcat}
                            disabled={stopDisabled}
                        >
                            ✕ 중지
                        </button>
                        <button
                            className="os-btn os-btn--secondary os-btn--sm"
                            type="button"
                            onClick={() => setIsChangedFilesOpen(true)}
                            style={{ flex: 1 }}
                        >
                            변경파일 ({changedCount}건)
                        </button>
                    </>
                )}
            </div>

            <ChangedFilesModal
                isOpen={isChangedFilesOpen}
                onClose={() => setIsChangedFilesOpen(false)}
                changedFiles={state.deploy.changedFiles}
                onApply={() => { actions.deploy.applyChangedFiles(); setIsChangedFilesOpen(false); }}
                isHotReloading={state.tomcat.isHotReloadMode}
            />
        </div>
    );
};
