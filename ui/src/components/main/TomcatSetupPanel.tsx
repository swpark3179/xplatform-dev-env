import React, { useState } from 'react';
import { TomcatInitModal } from './TomcatInitModal';
import { AppActions, AppState } from '@/hooks/useAppState';
import { DeployListModal } from './DeployListModal';
import { DeployFavoriteModal } from './DeployFavoriteModal';

export const TomcatSetupPanel: React.FC<{ state: AppState, actions: AppActions }> = ({ state, actions }) => {
    const [isInitModalOpen, setIsInitModalOpen] = useState(false);
    const [initModalRect, setInitModalRect] = useState<DOMRect | null>(null);
    const [isDeployListOpen, setIsDeployListOpen] = useState(false);
    const [isDeployFavoriteOpen, setIsDeployFavoriteOpen] = useState(false);

    const initDisabled = state.tomcat.running || state.tomcat.initializing || state.build.isGradleRunning;
    const deployCount = state.deploy.deployFileList.java.length + state.deploy.deployFileList.query.length;

    return (
        <>
            <div className="os-panel">
                <div className="os-panel__head">
                    <div className="os-panel__title">Tomcat 환경 설정</div>
                </div>

                <div className="os-kv-row">
                    <span className="os-kv-row__label">Context</span>
                    <span className="os-kv-row__value">{state.tomcat.contextRoot || '—'}</span>
                    <button
                        className="os-kv-row__icon"
                        type="button"
                        disabled={initDisabled}
                        onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setInitModalRect(rect);
                            setIsInitModalOpen(true);
                        }}
                        title="초기화"
                        aria-label="초기화"
                    >
                        ⚙ 초기화
                    </button>
                </div>

                <div className="os-kv-row">
                    <span className="os-kv-row__label">배포 모드</span>
                    <label
                        className="os-switch-row"
                        onClick={() => {
                            if (initDisabled) return;
                            const next = state.tomcat.deployMode === 'selected' ? 'default' : 'selected';
                            actions.tomcat.initTomcat(
                                state.tomcat.contextRoot,
                                state.tomcat.profile,
                                state.tomcat.isBatch,
                                next,
                            );
                        }}
                        style={{ opacity: initDisabled ? 0.5 : 1, cursor: initDisabled ? 'not-allowed' : 'pointer', padding: 0, gap: 6 }}
                    >
                        <span className={`os-switch ${state.tomcat.deployMode === 'selected' ? 'os-switch--on' : ''}`} />
                        <span style={{ fontSize: 11 }}>
                            {state.tomcat.deployMode === 'selected' ? '선택' : '기본'}
                        </span>
                    </label>
                    {state.tomcat.deployMode === 'selected' && (
                        <span style={{ fontSize: 10.5, color: 'var(--oz-fg-muted)' }}>· {deployCount}건</span>
                    )}
                </div>

                {state.tomcat.deployMode === 'selected' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                        <button
                            className="os-btn os-btn--secondary os-btn--sm"
                            type="button"
                            onClick={() => setIsDeployListOpen(true)}
                            style={{ width: '100%' }}
                        >
                            배포목록 관리 ({deployCount})
                        </button>
                        <button
                            className="os-btn os-btn--secondary os-btn--sm"
                            type="button"
                            onClick={() => setIsDeployFavoriteOpen(true)}
                            style={{ width: '100%' }}
                        >
                            ★ 즐겨찾기{state.deploy.activeFavoriteName ? ` [${state.deploy.activeFavoriteName}]` : ''}
                        </button>
                    </div>
                )}
            </div>

            <TomcatInitModal
                isOpen={isInitModalOpen}
                initRect={initModalRect}
                tomcatState={state.tomcat}
                actions={actions}
                onClose={() => setIsInitModalOpen(false)}
            />

            <DeployListModal
                isOpen={isDeployListOpen}
                onClose={() => setIsDeployListOpen(false)}
                state={state}
                actions={actions}
            />

            <DeployFavoriteModal
                isOpen={isDeployFavoriteOpen}
                onClose={() => setIsDeployFavoriteOpen(false)}
                state={state}
                actions={actions}
            />
        </>
    );
};
