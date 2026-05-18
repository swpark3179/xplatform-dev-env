import React, { useState } from 'react';
import { Pill } from '../common';

export interface GitIgnoreItem {
    path: string;
    sub: string;
    recommended?: boolean;
    applied: boolean;
}

const DEFAULT_ITEMS: GitIgnoreItem[] = [
    { path: 'src/webapp/ui/default_typedef.xml', sub: 'UX Studio 가 자동 수정', recommended: true, applied: false },
    { path: '.vscode/settings.json', sub: '로컬 경로 설정', applied: true },
    { path: 'src/main/resources/database.yml', sub: 'DB 접속 정보', applied: true },
    { path: 'build.gradle', sub: '임시 의존성', applied: true },
];

interface Props {
    onToast?: (msg: string) => void;
}

const GitIgnorePanel: React.FC<Props> = ({ onToast }) => {
    const [items, setItems] = useState<GitIgnoreItem[]>(DEFAULT_ITEMS);

    const fileName = (p: string) => p.split('/').pop() ?? p;

    const apply = (path: string) => {
        setItems(prev => prev.map(it => it.path === path ? { ...it, applied: true } : it));
        onToast?.(`${fileName(path)} — 로컬 무시 적용`);
    };
    const release = (path: string) => {
        setItems(prev => prev.map(it => it.path === path ? { ...it, applied: false } : it));
        onToast?.(`${fileName(path)} — 로컬 무시 해제`);
    };

    const appliedItems = items.filter(it => it.applied);
    const recommended = items.find(it => it.recommended && !it.applied);

    return (
        <div className="os-panel">
            <div className="os-panel__head">
                <div className="os-panel__title">
                    <span style={{ color: 'var(--oz-fg-accent)', marginRight: 4 }}>⎇</span>
                    로컬 Git 무시
                </div>
                {appliedItems.length > 0 && <Pill tone="accent">{appliedItems.length} 적용중</Pill>}
            </div>
            <div className="os-panel__sub">
                <code style={{ fontFamily: 'var(--oz-font-mono)', fontSize: 10.5 }}>git update-index --skip-worktree</code>
                {' — 내 로컬에서만 변경을 추적에서 제외합니다. push 에 영향 없음.'}
            </div>

            <div className="os-hint">
                <span className="os-hint__icon">ⓘ</span>
                <span>
                    Explorer 에서 파일을 우클릭 → <kbd>XPlatform: 로컬 Git 무시 추가</kbd> 로도 등록할 수 있어요.
                </span>
            </div>

            {items.length === 0 ? (
                <div className="os-file-empty" style={{ height: 'auto', padding: 16 }}>
                    <span>아직 등록된 파일이 없습니다</span>
                </div>
            ) : (
                <div className="os-git-list">
                    {recommended && (
                        <div className="os-git-row os-git-row--recommended" key={recommended.path}>
                            <span className="os-git-row__icon">⚠</span>
                            <div className="os-git-row__main">
                                <span className="os-git-row__path">{recommended.path}</span>
                                <span className="os-git-row__sub">{recommended.sub} — 권장</span>
                            </div>
                            <button
                                className="os-git-row__action os-git-row__action--apply"
                                type="button"
                                onClick={() => apply(recommended.path)}
                            >
                                적용
                            </button>
                        </div>
                    )}
                    {appliedItems.map(f => (
                        <div key={f.path} className="os-git-row">
                            <span className="os-git-row__icon">🚫</span>
                            <div className="os-git-row__main">
                                <span className="os-git-row__path">{f.path}</span>
                                <span className="os-git-row__sub">{f.sub} · skip-worktree</span>
                            </div>
                            <button
                                className="os-git-row__action os-git-row__action--release"
                                type="button"
                                onClick={() => release(f.path)}
                            >
                                해제
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="os-step-nav">
                <button className="os-btn os-btn--ghost os-btn--sm" type="button">↻ 원래 상태로 동기화</button>
                <span style={{ flex: 1 }} />
                <button className="os-btn os-btn--secondary os-btn--sm" type="button">+ 파일 추가</button>
            </div>
        </div>
    );
};

export default GitIgnorePanel;
