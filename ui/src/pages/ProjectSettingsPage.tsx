import React, { useState } from 'react';
import { useToast } from '../components/common';
import {
    WorkspaceSettingsPanel,
    HomeSettingsPanel,
    GitIgnorePanel,
} from '../components/project-settings';
import { AppActions, AppState } from '@/hooks/useAppState';

const ProjectSettingsPage: React.FC<{ actions: AppActions; state: AppState }> = ({ actions, state }) => {
    const { showToast, toastNode } = useToast();
    const [expandedWorkspace, setExpandedWorkspace] = useState(false);
    const [expandedHome, setExpandedHome] = useState(false);

    return (
        <>
            <div className="os-header">
                <button
                    className="os-header__icon-btn"
                    onClick={actions.navigation.goToMain}
                    title="뒤로"
                    aria-label="뒤로"
                >
                    ←
                </button>
                <span className="os-header__title">프로젝트 설정</span>
            </div>

            {expandedWorkspace ? (
                <WorkspaceSettingsPanel onApplySettings={actions.project.applyProjectSettings} />
            ) : (
                <div className="os-panel-collapsed" onClick={() => setExpandedWorkspace(true)}>
                    <span className="os-panel-collapsed__icon">📁</span>
                    <div className="os-panel-collapsed__main">
                        <span className="os-panel-collapsed__title">VSCode 워크스페이스 설정</span>
                        <span className="os-panel-collapsed__sub">.vscode/settings.json — Gradle/JDK, 폴더 숨김</span>
                    </div>
                    <span className="os-panel-collapsed__caret">▾</span>
                </div>
            )}

            {expandedHome ? (
                <HomeSettingsPanel onSetupHomeSettings={actions.project.setupHomeSettings} />
            ) : (
                <div className="os-panel-collapsed" onClick={() => setExpandedHome(true)}>
                    <span className="os-panel-collapsed__icon">📁</span>
                    <div className="os-panel-collapsed__main">
                        <span className="os-panel-collapsed__title">홈 디렉토리 설정</span>
                        <span className="os-panel-collapsed__sub">개인 라이브러리 · 외부 모듈</span>
                    </div>
                    <span className="os-panel-collapsed__caret">▾</span>
                </div>
            )}

            <GitIgnorePanel
                items={state.gitIgnore.items}
                lastAction={state.gitIgnore.lastAction}
                actions={actions.gitIgnore}
                onToast={showToast}
            />

            {toastNode}
        </>
    );
};

export default ProjectSettingsPage;
