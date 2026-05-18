import { useEffect } from 'react';
import { BuildPanel, TomcatSetupPanel, TomcatControlPanel } from '../components/main';
import { AppActions, AppState } from '@/hooks/useAppState';

const MainPage: React.FC<{ state: AppState, actions: AppActions }> = ({ state, actions }) => {
    useEffect(() => {
        if (state.uxStudio.isDevMode === null) {
            actions.uxStudio.init();
        }
    }, []);

    const isDevMode = state.uxStudio.isDevMode;

    return (
        <>
            <div className="os-header">
                <span className="os-header__title" style={{ visibility: 'hidden' }}>.</span>
                <button
                    className="os-btn os-btn--secondary os-btn--sm"
                    type="button"
                    onClick={actions.navigation.goToProjectSettings}
                    title="프로젝트 설정"
                >
                    프로젝트
                </button>
                <button
                    className="os-btn os-btn--secondary os-btn--sm"
                    type="button"
                    onClick={actions.navigation.goToSettings}
                    title="환경 설정"
                >
                    설정
                </button>
            </div>

            <BuildPanel
                onBuildClasses={actions.build.buildClasses}
                onCleanProject={actions.build.cleanProject}
                onStopGradle={actions.build.stopGradle}
                state={state}
            />

            <TomcatSetupPanel state={state} actions={actions} />

            <TomcatControlPanel state={state} actions={actions} />

            <div className="os-ux-footer">
                {isDevMode === null ? (
                    <div style={{ fontSize: 11, color: 'var(--oz-fg-muted)', textAlign: 'center' }}>확인 중...</div>
                ) : isDevMode ? (
                    <button
                        className="os-ux-footer__btn"
                        type="button"
                        onClick={actions.navigation.goToUxStudio}
                    >
                        ↗ UX Studio 시작환경 관리
                    </button>
                ) : (
                    <div className="os-ux-footer__info">
                        <span className="os-ux-footer__info-icon">ⓘ</span>
                        <div className="os-ux-footer__info-text">
                            <span style={{ fontWeight: 600 }}>UX Studio 관리는 Windows 개발자 모드가 필요합니다.</span>
                            <span style={{ opacity: 0.85 }}>활성화 후 사용할 수 있습니다.</span>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default MainPage;
