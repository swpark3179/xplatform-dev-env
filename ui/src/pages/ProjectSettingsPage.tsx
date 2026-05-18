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

            <div className="os-panel os-panel--tight" style={{ background: 'var(--oz-bg-muted)' }}>
                <div className="os-panel__head">
                    <div
                        className="os-panel__title"
                        style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--oz-fg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
                    >
                        EXPLORER 우클릭 메뉴 미리보기
                    </div>
                </div>
                <div className="os-ctx-menu">
                    <div className="os-ctx-menu__row os-ctx-menu__row--muted">Open</div>
                    <div className="os-ctx-menu__row os-ctx-menu__row--muted">Open to the Side</div>
                    <div className="os-ctx-menu__divider" />
                    <div className="os-ctx-menu__row os-ctx-menu__row--muted">Copy Path</div>
                    <div className="os-ctx-menu__divider" />
                    <div className="os-ctx-menu__row">⎇ SHI 배포대상 추가/제거</div>
                    <div className="os-ctx-menu__row os-ctx-menu__row--hi">⎇ XPlatform: 로컬 Git 무시 추가</div>
                    <div className="os-ctx-menu__divider" />
                    <div className="os-ctx-menu__row os-ctx-menu__row--muted">Delete</div>
                </div>
            </div>

            {toastNode}
        </>
    );
};

export default ProjectSettingsPage;
