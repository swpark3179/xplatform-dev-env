import { useEffect, useState } from "react";
import { AppActions, AppState } from "@/hooks/useAppState";
import { Pill, StepperHeader, useToast, Modal } from "../components/common";
import type { StepDef } from "../components/common";
import type { UxStudioEnvConfig } from "../types";

function baseXprjName(filePath: string): string {
    return filePath.split('/').pop()?.replace(/\.xprj$/i, '') ?? filePath;
}

function fileBaseName(p: string): string { return p.split('/').pop() ?? p; }
function fileDirName(p: string): string {
    const parts = p.split('/');
    return parts.slice(0, -1).join('/');
}

const UxStudioPage: React.FC<{ state: AppState; actions: AppActions }> = ({ state, actions }) => {
    const { status, envConfig, xfdlFiles, xprjFiles, confirmErrorFiles } = state.uxStudio;
    const { showToast, toastNode } = useToast();

    const [step, setStep] = useState(1);
    const [mode, setMode] = useState<'default' | 'selected'>('selected');
    const [urlAutoCorrect, setUrlAutoCorrect] = useState(true);
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [applied, setApplied] = useState(false);
    const [filesConfirmed, setFilesConfirmed] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);

    useEffect(() => {
        actions.uxStudio.init();
    }, []);

    // Seed from existing envConfig once configured
    useEffect(() => {
        if (status === 'configured' && envConfig) {
            setMode(envConfig.mode);
            setUrlAutoCorrect(envConfig.urlAutoCorrect);
            if (envConfig.selectedFiles) setSelectedFiles(envConfig.selectedFiles);
            setApplied(true);
            const filesOk = envConfig.mode === 'default' || (envConfig.selectedFiles?.length ?? 0) > 0;
            setFilesConfirmed(filesOk);
            // 선택 모드에서 작업파일이 아직 확정되지 않았다면 2단계로 이동.
            // 그 외(기본 모드, 또는 파일 확정 완료)에는 3단계 실행 화면으로.
            setStep(filesOk ? 3 : 2);
        } else if (status === 'new') {
            setStep(1);
        }
    }, [status, envConfig]);

    // Step numbers stay stable across modes (1=모드, 2=작업파일, 3=실행).
    // Default mode hides step 2.
    const steps: StepDef[] = mode === 'selected'
        ? [{ n: 1, label: '모드' }, { n: 2, label: '작업파일' }, { n: 3, label: '실행' }]
        : [{ n: 1, label: '모드' }, { n: 3, label: '실행' }];

    // If mode flips from selected → default while sitting on step 2, jump to launch.
    useEffect(() => {
        if (!steps.find(s => s.n === step)) setStep(steps[steps.length - 1].n);
    }, [mode]);

    const completed: number[] = [];
    if (applied) completed.push(1);
    if (filesConfirmed) completed.push(2);

    const jump = (n: number) => setStep(n);
    const goNext = () => {
        const idx = steps.findIndex(s => s.n === step);
        if (idx >= 0 && idx < steps.length - 1) setStep(steps[idx + 1].n);
    };
    const goPrev = () => {
        const idx = steps.findIndex(s => s.n === step);
        if (idx > 0) setStep(steps[idx - 1].n);
    };

    const applyStep1 = () => {
        const config: UxStudioEnvConfig = {
            mode,
            customPrefixIds: [],
            urlAutoCorrect,
        };
        actions.uxStudio.applySettings(config);
        setApplied(true);
        showToast('설정을 적용했습니다');
        goNext();
    };

    const confirmStep2 = () => {
        if (selectedFiles.length === 0) return;
        actions.uxStudio.confirmFiles(selectedFiles);
        setFilesConfirmed(true);
        showToast(`${selectedFiles.length}개 파일을 복사했습니다`);
        goNext();
    };

    const handleResetConfirm = () => {
        setIsResetModalOpen(false);
        actions.uxStudio.resetSetup();
        setStep(1);
        setMode('selected');
        setUrlAutoCorrect(true);
        setSelectedFiles([]);
        setApplied(false);
        setFilesConfirmed(false);
        showToast('설정을 초기화했습니다');
    };

    if (status === null) {
        return (
            <div className="ux-studio-page">
                <div className="ux-studio-page__loading">
                    <div className="loading-spinner" aria-hidden="true" />
                    <span>초기화 중...</span>
                </div>
            </div>
        );
    }

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
                <span className="os-header__title">UX Studio 시작환경</span>
                <button
                    className="os-header__icon-btn"
                    title="처음부터 다시"
                    onClick={() => setIsResetModalOpen(true)}
                >
                    ↻
                </button>
            </div>

            {isResetModalOpen && (
                <Modal
                    isOpen={true}
                    title="설정 초기화"
                    onClose={() => setIsResetModalOpen(false)}
                    onConfirm={handleResetConfirm}
                    confirmText="예"
                    cancelText="아니오"
                >
                    설정을 초기화하면 현재 설정 정보가 삭제됩니다. 계속하시겠습니까?
                </Modal>
            )}

            <div className="os-panel os-panel--tight">
                <StepperHeader steps={steps} active={step} completed={completed} onJump={jump} />
            </div>

            {step === 1 && (
                <Step1Mode
                    mode={mode}
                    setMode={setMode}
                    urlAutoCorrect={urlAutoCorrect}
                    setUrlAutoCorrect={setUrlAutoCorrect}
                    onApply={applyStep1}
                />
            )}
            {step === 2 && (
                <Step2Files
                    xfdlFiles={xfdlFiles}
                    selectedFiles={selectedFiles}
                    setSelectedFiles={(updater) => {
                        setSelectedFiles(updater);
                        setFilesConfirmed(false);
                    }}
                    confirmErrorFiles={confirmErrorFiles || []}
                    onClearConfirmError={() => actions.uxStudio.clearConfirmError()}
                    onRefresh={() => actions.uxStudio.searchXfdl()}
                    onPrev={goPrev}
                    onConfirm={confirmStep2}
                />
            )}
            {step === 3 && (
                <Step3Launch
                    mode={mode}
                    urlAutoCorrect={urlAutoCorrect}
                    selectedFilesCount={selectedFiles.length}
                    xprjFiles={xprjFiles}
                    onLaunch={(p) => actions.uxStudio.launchXprj(p)}
                    onPrev={goPrev}
                />
            )}

            <div style={{ fontSize: 10, color: 'var(--oz-fg-subtle)', textAlign: 'center', padding: '4px 8px', fontFamily: 'var(--oz-font-mono)' }}>
                env.json · .vscode/ui-env/
            </div>

            {toastNode}
        </>
    );
};

// ===== Step 1 — Mode (with inline URL autocorrect toggle for selected mode) =====
const Step1Mode: React.FC<{
    mode: 'default' | 'selected';
    setMode: (m: 'default' | 'selected') => void;
    urlAutoCorrect: boolean;
    setUrlAutoCorrect: (v: boolean) => void;
    onApply: () => void;
}> = ({ mode, setMode, urlAutoCorrect, setUrlAutoCorrect, onApply }) => (
    <div className="os-panel">
        <div className="os-panel__head">
            <div className="os-panel__title">1. 실행 모드 선택</div>
        </div>
        <div className="os-panel__sub">
            <strong style={{ color: 'var(--oz-fg-secondary)' }}>기본</strong>은 src/webapp/ui 전체를 그대로 띄우고, <strong style={{ color: 'var(--oz-fg-secondary)' }}>선택</strong>은 작업할 파일만 골라 ui-env로 복사해서 띄웁니다.
        </div>

        <div className="os-mode-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
            <button
                type="button"
                className={`os-mode-card${mode === 'default' ? ' os-mode-card--active' : ''}`}
                onClick={() => setMode('default')}
                style={{ padding: '12px 14px' }}
            >
                <div className="os-mode-card__title">
                    <span className={`os-radio ${mode === 'default' ? 'os-radio--checked' : ''}`} />
                    기본 모드
                </div>
                <div className="os-mode-card__sub" style={{ paddingLeft: 22, marginTop: 4 }}>
                    전체 ui/ 를 그대로 사용. 별도 복사 없이 빠르게 실행.
                </div>
            </button>

            <button
                type="button"
                className={`os-mode-card${mode === 'selected' ? ' os-mode-card--active' : ''}`}
                onClick={() => setMode('selected')}
                style={{ padding: '12px 14px' }}
            >
                <div className="os-mode-card__title">
                    <span className={`os-radio ${mode === 'selected' ? 'os-radio--checked' : ''}`} />
                    선택 모드
                </div>
                <div className="os-mode-card__sub" style={{ paddingLeft: 22, marginTop: 4 }}>
                    내가 작업할 .xfdl / .xjs 파일만 골라서 가볍게 띄움.
                </div>
            </button>
        </div>

        <label className="os-switch-row" onClick={() => setUrlAutoCorrect(!urlAutoCorrect)}>
            <span className={`os-switch ${urlAutoCorrect ? 'os-switch--on' : ''}`} />
            <div className="os-switch-row__text">
                <span style={{ fontWeight: 500 }}>URL 자동보정</span>
                <span className="os-switch-row__hint">
                    localhost:7001/ep/ → 60.101.107.57:8002/ep/
                    {mode === 'default' && ' · 원본 default_typedef.xml이 직접 수정됩니다'}
                </span>
            </div>
        </label>

        <div className="os-step-nav">
            <span style={{ flex: 1 }} />
            <button className="os-btn" type="button" onClick={onApply}>
                ✓ 설정 적용
            </button>
        </div>
    </div>
);

// ===== Step 2 — Files =====
const Step2Files: React.FC<{
    xfdlFiles: string[];
    selectedFiles: string[];
    setSelectedFiles: (updater: (prev: string[]) => string[]) => void;
    confirmErrorFiles: string[];
    onClearConfirmError: () => void;
    onRefresh: () => void;
    onPrev: () => void;
    onConfirm: () => void;
}> = ({ xfdlFiles, selectedFiles, setSelectedFiles, confirmErrorFiles, onClearConfirmError, onRefresh, onPrev, onConfirm }) => {
    const [q, setQ] = useState('');
    const selectedSet = new Set(selectedFiles);
    const available = xfdlFiles
        .filter(f => !selectedSet.has(f))
        .filter(f => !q || f.toLowerCase().includes(q.toLowerCase()));

    const addFile = (f: string) => setSelectedFiles(prev => [...prev, f].sort());
    const removeFile = (f: string) => setSelectedFiles(prev => prev.filter(x => x !== f));

    return (
        <div className="os-panel">
            {confirmErrorFiles.length > 0 && (
                <Modal
                    isOpen={true}
                    title="파일 복사 실패"
                    onClose={onClearConfirmError}
                    onConfirm={onClearConfirmError}
                    confirmText="확인"
                    cancelText=""
                >
                    <div style={{ marginBottom: 10 }}>
                        다음 파일들이 사용 중이거나 권한이 없어 복사하지 못했습니다.
                    </div>
                    <ul style={{ maxHeight: 150, overflowY: 'auto', padding: '5px 5px 5px 25px' }}>
                        {confirmErrorFiles.map(f => <li key={f}>{f}</li>)}
                    </ul>
                </Modal>
            )}

            <div className="os-panel__head">
                <div className="os-panel__title">2. 작업파일 선택</div>
                <Pill tone="neutral">{selectedFiles.length} 선택</Pill>
                <button className="os-header__icon-btn" title="새로고침" onClick={onRefresh}>↻</button>
            </div>
            <div className="os-panel__sub">
                선택한 .xfdl / .xjs 만 ui-env/ 로 복사됩니다. 좌측에서 클릭 → 우측에서 클릭하면 제거됩니다.
            </div>

            <div className="os-file-columns">
                <div className="os-file-col">
                    <div className="os-file-col__label">전체 <span className="os-file-col__count">{available.length}</span></div>
                    <div className="os-search">
                        <span className="os-search__icon">🔍</span>
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="파일명 검색…" />
                    </div>
                    <div className="os-file-list">
                        {available.map(f => (
                            <div key={f} className="os-file-item" onClick={() => addFile(f)} title={f}>
                                <span className="os-file-item__name">{fileBaseName(f)}</span>
                                <span className="os-file-item__dir">{fileDirName(f)}</span>
                            </div>
                        ))}
                        {available.length === 0 && (
                            <div className="os-file-empty"><span>모두 선택됨</span></div>
                        )}
                    </div>
                </div>
                <div className="os-file-col">
                    <div className="os-file-col__label">선택 <span className="os-file-col__count">{selectedFiles.length}</span></div>
                    <div style={{ height: 25 }} />
                    <div className="os-file-list os-file-list--selected">
                        {selectedFiles.map(f => (
                            <div key={f} className="os-file-item" onClick={() => removeFile(f)} title={`${f} — 클릭하면 제거`}>
                                <span className="os-file-item__name">{fileBaseName(f)}</span>
                                <span className="os-file-item__dir">{fileDirName(f)}</span>
                            </div>
                        ))}
                        {selectedFiles.length === 0 && (
                            <div className="os-file-empty"><span>좌측에서 파일을 골라주세요</span></div>
                        )}
                    </div>
                </div>
            </div>

            <div className="os-step-nav">
                <button className="os-btn os-btn--secondary os-btn--sm" type="button" onClick={onPrev}>← 이전</button>
                <span style={{ flex: 1 }} />
                <button className="os-btn" type="button" onClick={onConfirm} disabled={selectedFiles.length === 0}>
                    확정 — {selectedFiles.length} 파일 복사 →
                </button>
            </div>
        </div>
    );
};

// ===== Step 3 — Launch =====
const Step3Launch: React.FC<{
    mode: 'default' | 'selected';
    urlAutoCorrect: boolean;
    selectedFilesCount: number;
    xprjFiles: string[];
    onLaunch: (p: string) => void;
    onPrev: () => void;
}> = ({ mode, urlAutoCorrect, selectedFilesCount, xprjFiles, onLaunch, onPrev }) => (
    <div className="os-panel">
        <div className="os-panel__head">
            <div className="os-panel__title">{mode === 'selected' ? '3.' : '2.'} UX Studio 실행</div>
            <Pill tone="success">✓ 설정 완료</Pill>
        </div>
        <div className="os-panel__sub">
            .vscode/ui-env/ 에 준비된 .xprj 파일을 클릭하면 UX Studio 로 띄웁니다.
        </div>

        {xprjFiles.length > 0 ? (
            <div className="os-launch-grid">
                {xprjFiles.map(filePath => {
                    const name = baseXprjName(filePath);
                    return (
                        <button key={filePath} type="button" className="os-launch-btn" onClick={() => onLaunch(filePath)} title={name}>
                            ▶ <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                        </button>
                    );
                })}
            </div>
        ) : (
            <div className="os-file-empty" style={{ height: 'auto', padding: 16 }}>
                <span>.vscode/ui-env/ 에 xprj 파일이 없습니다</span>
            </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: 'var(--oz-bg-muted)', borderRadius: 'var(--oz-r-md)', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--oz-fg-muted)', minWidth: 56 }}>모드</span>
                <span style={{ color: 'var(--oz-fg-default)' }}>
                    {`${mode === 'selected' ? '선택 모드' : '기본 모드'} · URL 자동보정 ${urlAutoCorrect ? 'ON' : 'OFF'}`}
                </span>
            </div>
            {mode === 'selected' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--oz-fg-muted)', minWidth: 56 }}>작업파일</span>
                    <span style={{ color: 'var(--oz-fg-default)' }}>{selectedFilesCount}개 복사됨</span>
                </div>
            )}
        </div>

        <div className="os-step-nav">
            <button className="os-btn os-btn--secondary os-btn--sm" type="button" onClick={onPrev}>← 이전</button>
            <span style={{ flex: 1 }} />
        </div>
    </div>
);

export default UxStudioPage;
