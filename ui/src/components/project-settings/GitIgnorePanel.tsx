import React, { useEffect, useRef } from 'react';
import { Pill } from '../common';
import type { GitIgnoreItem } from '../../types';

interface GitIgnoreActions {
    refresh: () => void;
    apply: (path: string) => void;
    release: (path: string) => void;
    addFile: () => void;
    sync: () => void;
}

interface Props {
    items: GitIgnoreItem[];
    lastAction: { action?: string; path?: string; message?: string } | null;
    actions: GitIgnoreActions;
    onToast?: (msg: string) => void;
}

const fileName = (p: string) => p.split('/').pop() ?? p;

const GitIgnorePanel: React.FC<Props> = ({ items, lastAction, actions, onToast }) => {
    // 패널 표시 시 한 번 데이터 로드
    useEffect(() => {
        actions.refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // lastAction 변경 시 토스트
    const lastSeen = useRef<typeof lastAction>(null);
    useEffect(() => {
        if (!lastAction || lastAction === lastSeen.current) return;
        lastSeen.current = lastAction;
        if (lastAction.action === 'apply' && lastAction.path) {
            onToast?.(`${fileName(lastAction.path)} — 로컬 무시 적용`);
        } else if (lastAction.action === 'release' && lastAction.path) {
            onToast?.(`${fileName(lastAction.path)} — 로컬 무시 해제`);
        } else if (lastAction.action === 'sync') {
            onToast?.('현재 상태로 동기화 완료');
        } else if (lastAction.action === 'error' && lastAction.message) {
            onToast?.(`오류: ${lastAction.message}`);
        }
    }, [lastAction, onToast]);

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
                    Explorer 에서 파일을 우클릭 → <kbd>XPlatform: 로컬 Git 무시 토글</kbd> 로도 적용/해제 할 수 있어요.
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
                                <span className="os-git-row__sub">{recommended.sub ?? ''} — 권장</span>
                            </div>
                            <button
                                className="os-git-row__action os-git-row__action--apply"
                                type="button"
                                onClick={() => actions.apply(recommended.path)}
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
                                <span className="os-git-row__sub">{f.sub ? `${f.sub} · ` : ''}skip-worktree</span>
                            </div>
                            <button
                                className="os-git-row__action os-git-row__action--release"
                                type="button"
                                onClick={() => actions.release(f.path)}
                            >
                                해제
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="os-step-nav">
                <button className="os-btn os-btn--ghost os-btn--sm" type="button" onClick={actions.sync}>↻ 현재 상태로 동기화</button>
                <span style={{ flex: 1 }} />
                <button className="os-btn os-btn--secondary os-btn--sm" type="button" onClick={actions.addFile}>+ 파일 추가</button>
            </div>
        </div>
    );
};

export default GitIgnorePanel;
