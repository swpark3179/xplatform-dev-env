import React, { useState } from 'react';
import { Panel, Button } from '../common';
import { TomcatInitModal } from './TomcatInitModal';
import { AppActions, AppState } from '@/hooks/useAppState';
import { DeployListModal } from './DeployListModal';
import { DeployFavoriteModal } from './DeployFavoriteModal';

export const TomcatSetupPanel: React.FC<{ state: AppState,  actions: AppActions }> = ({ state, actions }) => {
    const [isInitModalOpen, setIsInitModalOpen] = useState(false);
    const [initModalRect, setInitModalRect] = useState<DOMRect | null>(null);
    const [isDeployListOpen, setIsDeployListOpen] = useState(false);
    const [isDeployFavoriteOpen, setIsDeployFavoriteOpen] = useState(false);
    return (
        <>
            <Panel title="Tomcat 환경 설정">
                <div className="context-root-section">
                    <label htmlFor="contextRootInput">context root</label>
                    <input
                        type="text"
                        id="contextRootInput"
                        value={state.tomcat.contextRoot}
                        readOnly
                        disabled
                    />
                    <Button variant="icon" disabled={state.tomcat.running || state.tomcat.initializing || state.build.isGradleRunning} onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setInitModalRect(rect);
                        setIsInitModalOpen(true);
                    }} title="초기화" aria-label="초기화">
                        <span className="icon">⚙</span>
                    </Button>
                </div>

                <br/><hr/>

                <div style={{ marginTop: '10px', display: 'flex' }}>
                    <label>현재 모드 : {(state.tomcat.deployMode === 'selected')? '선택 모드' : '기본 모드'}</label>
                </div>

                {state.tomcat.deployMode === 'selected' && (
                    <>
                        <label>Tomcat 기동 시 아래 배포목록만 포함됩니다.</label>
                        <Button
                            variant="secondary"
                            className="header-btn"
                            onClick={() => setIsDeployListOpen(true)}
                            style={{ width: '100%' }}
                        >
                            배포목록관리 ({state.deploy.deployFileList.java.length + state.deploy.deployFileList.query.length}건)
                        </Button>
                        <Button
                            variant="secondary"
                            className="header-btn"
                            onClick={() => setIsDeployFavoriteOpen(true)}
                            style={{ width: '100%', marginTop: '4px' }}
                        >
                            ★ 배포목록 즐겨찾기{state.deploy.activeFavoriteName ? ` [${state.deploy.activeFavoriteName}]` : ''}
                        </Button>
                    </>
                )}
            </Panel>

            {/* Tomcat 초기화 팝업 */}
            <TomcatInitModal
                isOpen={isInitModalOpen}
                initRect={initModalRect}
                tomcatState={state.tomcat}
                actions={actions}
                onClose={() => setIsInitModalOpen(false)}
            />

            {/* 배포목록관리 팝업 */}
            <DeployListModal
                isOpen={isDeployListOpen}
                onClose={() => setIsDeployListOpen(false)}
                state={state}
                actions={actions}
            />

            {/* 배포목록 즐겨찾기 팝업 */}
            <DeployFavoriteModal
                isOpen={isDeployFavoriteOpen}
                onClose={() => setIsDeployFavoriteOpen(false)}
                state={state}
                actions={actions}
            />
        </>
    );
};
