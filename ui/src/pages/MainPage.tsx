import { useEffect } from 'react';
import { Header, Button } from '../components/common';
import { BuildPanel, TomcatSetupPanel, TomcatControlPanel } from '../components/main';
import { AppActions, AppState } from '@/hooks/useAppState';

const MainPage: React.FC<{ state: AppState, actions: AppActions }> = ({ state, actions }) => {
    // 메인 페이지 진입 시 개발자 모드 여부를 백엔드에 확인 (최초 1회)
    useEffect(() => {
        if (state.uxStudio.isDevMode === null) {
            actions.uxStudio.init();
        }
    }, []);

    const isDevMode = state.uxStudio.isDevMode;

    return (
        <>
            <Header title="">
                <Button variant="secondary" className="header-btn" onClick={actions.navigation.goToProjectSettings} title="프로젝트 설정">프로젝트</Button>
                <Button variant="secondary" className="header-btn" onClick={actions.navigation.goToSettings} title="환경 설정">설정</Button>
            </Header>

            <BuildPanel
                onBuildClasses={actions.build.buildClasses}
                onCleanProject={actions.build.cleanProject}
                onStopGradle={actions.build.stopGradle}
                state={state}
            />

            <TomcatSetupPanel state={state} actions={actions} />

            <TomcatControlPanel state={state} actions={actions} />

            {/* UX Studio 관리 — 최하단 */}
            <div className="ux-studio-footer">
                {isDevMode === null ? (
                    // 확인 중
                    <div className="ux-studio-footer__checking">확인 중...</div>
                ) : isDevMode ? (
                    <button
                        className="ux-studio-footer__btn"
                        onClick={actions.navigation.goToUxStudio}
                    >
                        UX Studio 관리
                    </button>
                ) : (
                    <div className="ux-studio-footer__no-devmode">
                        개발자 모드가 아닙니다 기능을 사용할 수 없습니다
                    </div>
                )}
            </div>
        </>
    );
};

export default MainPage;
