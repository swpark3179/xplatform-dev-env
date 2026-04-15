import React, { useState } from 'react';
import { Modal } from '../common';
import { AppActions, AppState } from '@/hooks/useAppState';
import { DeployFavorite } from '@/types';

type DialogState =
    | { kind: 'none' }
    | { kind: 'apply'; favorite: DeployFavorite }
    | { kind: 'delete'; favorite: DeployFavorite }
    | { kind: 'nameInput'; mode: 'save' };

export const DeployFavoriteModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    state: AppState;
    actions: AppActions;
}> = ({ isOpen, onClose, state, actions }) => {
    const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
    const [nameInput, setNameInput] = useState('');

    const { favorites, activeFavoriteId, activeFavoriteName, deployFileList } = state.deploy;
    const totalCount = deployFileList.java.length + deployFileList.query.length;
    const hasFiles = totalCount > 0;

    /** 팝업 닫기 + 상태 초기화 */
    const handleClose = () => {
        setDialog({ kind: 'none' });
        setNameInput('');
        onClose();
    };

    /** 리프레시 버튼 */
    const handleRefresh = () => {
        actions.deploy.loadFavorites();
    };

    /** 새 이름으로 저장 버튼 클릭 → 이름 입력 다이얼로그 */
    const handleSaveNew = () => {
        setNameInput('');
        setDialog({ kind: 'nameInput', mode: 'save' });
    };

    /** 덮어쓰기 버튼 클릭 */
    const handleOverwrite = () => {
        if (!activeFavoriteId) return;
        actions.deploy.overwriteFavorite(activeFavoriteId, deployFileList.java, deployFileList.query);
    };

    /** 즐겨찾기 이름 입력 후 확인 */
    const handleNameConfirm = () => {
        const trimmed = nameInput.trim();
        if (!trimmed) return;
        if (dialog.kind === 'nameInput' && dialog.mode === 'save') {
            actions.deploy.saveFavorite(trimmed, deployFileList.java, deployFileList.query);
        }
        setDialog({ kind: 'none' });
        setNameInput('');
    };

    /** 즐겨찾기 이름 클릭 → 적용 확인 다이얼로그 */
    const handleFavoriteClick = (fav: DeployFavorite) => {
        setDialog({ kind: 'apply', favorite: fav });
    };

    /** 즐겨찾기 적용 확인 */
    const handleApplyConfirm = () => {
        if (dialog.kind !== 'apply') return;
        actions.deploy.applyFavorite(dialog.favorite.id);
        setDialog({ kind: 'none' });
    };

    /** - 버튼 클릭 → 삭제 확인 다이얼로그 */
    const handleDeleteClick = (e: React.MouseEvent, fav: DeployFavorite) => {
        e.stopPropagation();
        setDialog({ kind: 'delete', favorite: fav });
    };

    /** 즐겨찾기 삭제 확인 */
    const handleDeleteConfirm = () => {
        if (dialog.kind !== 'delete') return;
        actions.deploy.deleteFavorite(dialog.favorite.id);
        setDialog({ kind: 'none' });
    };

    const isActiveOverwritable = !!activeFavoriteId && hasFiles;

    return (
        <>
            <Modal
                isOpen={isOpen}
                title="배포목록 즐겨찾기"
                onClose={handleClose}
                onConfirm={handleClose}
                confirmText="닫기"
                hideCancel={true}
                position={{ left: 0, top: 50 }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                    {/* 현재 즐겨찾기 상태 + 저장 버튼 영역 */}
                    <div style={{
                        padding: '8px 10px',
                        border: '1px solid var(--vscode-panel-border)',
                        borderRadius: '3px',
                        backgroundColor: 'var(--vscode-sideBar-background)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                    }}>
                        <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
                            {activeFavoriteId
                                ? <>현재 선택됨: <strong style={{ color: 'var(--vscode-foreground)' }}>★ {activeFavoriteName}</strong></>
                                : '현재 선택된 즐겨찾기 없음'
                            }
                        </div>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                            {isActiveOverwritable && (
                                <button
                                    onClick={handleOverwrite}
                                    title="현재 배포목록으로 선택된 즐겨찾기를 덮어씁니다"
                                    aria-label="현재 배포목록으로 선택된 즐겨찾기를 덮어씁니다"
                                    style={btnStyle}
                                >
                                    💾 덮어쓰기
                                </button>
                            )}
                            <button
                                onClick={handleSaveNew}
                                disabled={!hasFiles}
                                title={hasFiles ? '현재 배포목록을 새 이름의 즐겨찾기로 저장합니다' : '배포목록이 비어있습니다'}
                                aria-label={hasFiles ? '현재 배포목록을 새 이름의 즐겨찾기로 저장합니다' : '배포목록이 비어있습니다'}
                                style={{ ...btnStyle, opacity: hasFiles ? 1 : 0.5, cursor: hasFiles ? 'pointer' : 'not-allowed' }}
                            >
                                ➕ 새 이름으로 저장
                            </button>
                        </div>
                    </div>

                    {/* 즐겨찾기 목록 */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                            <h5 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--vscode-descriptionForeground)' }}>
                                즐겨찾기 목록 ({favorites.length})
                            </h5>
                            <button
                                onClick={handleRefresh}
                                title="즐겨찾기 목록 새로고침"
                                aria-label="즐겨찾기 목록 새로고침"
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--vscode-foreground)', fontSize: '12px', padding: '2px 4px' }}
                            >
                                🔄
                            </button>
                        </div>
                        <div style={{
                            border: '1px solid var(--vscode-panel-border)',
                            borderRadius: '3px',
                            minHeight: '80px',
                            maxHeight: '200px',
                            overflowY: 'auto',
                            backgroundColor: 'var(--vscode-sideBar-background)',
                        }}>
                            {favorites.length === 0 ? (
                                <div style={{ padding: '10px', textAlign: 'center', fontSize: '11px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' }}>
                                    저장된 즐겨찾기가 없습니다.
                                </div>
                            ) : (
                                favorites.map(fav => (
                                    <div
                                        key={fav.id}
                                        className="tree-item"
                                        onClick={() => handleFavoriteClick(fav)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '5px 8px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid var(--vscode-panel-border)',
                                            backgroundColor: fav.id === activeFavoriteId ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                                            color: fav.id === activeFavoriteId ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit',
                                        }}
                                    >
                                        <span style={{ flex: 1, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {fav.id === activeFavoriteId && <span style={{ marginRight: '4px' }}>★</span>}
                                            {fav.name}
                                            <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.7 }}>
                                                (Java {fav.java.length} / Query {fav.query.length})
                                            </span>
                                        </span>
                                        <button
                                            onClick={(e) => handleDeleteClick(e, fav)}
                                            title="즐겨찾기 삭제"
                                            aria-label={`${fav.name} 즐겨찾기 삭제`}
                                            className="icon-btn tree-item-action"
                                            style={{ width: '20px', height: '20px', border: 'none', background: 'transparent', color: 'inherit', padding: 0, flexShrink: 0 }}
                                        >
                                            −
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* 이름 입력 다이얼로그 */}
            {dialog.kind === 'nameInput' && (
                <div style={overlayStyle}>
                    <div style={dialogBoxStyle}>
                        <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }}>즐겨찾기 이름 입력</div>
                        <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginBottom: '8px' }}>
                            현재 배포목록 (Java {deployFileList.java.length}건 / Query {deployFileList.query.length}건) 을 저장합니다.
                        </div>
                        <input
                            autoFocus
                            type="text"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleNameConfirm(); if (e.key === 'Escape') setDialog({ kind: 'none' }); }}
                            placeholder="즐겨찾기 이름을 입력하세요"
                            style={{ width: '100%', marginBottom: '10px', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setDialog({ kind: 'none' })} style={btnStyle}>취소</button>
                            <button onClick={handleNameConfirm} disabled={!nameInput.trim()} style={{ ...btnStyle, opacity: nameInput.trim() ? 1 : 0.5, cursor: nameInput.trim() ? 'pointer' : 'not-allowed' }}>확인</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 즐겨찾기 적용 확인 다이얼로그 */}
            {dialog.kind === 'apply' && (
                <div style={overlayStyle}>
                    <div style={dialogBoxStyle}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px' }}>즐겨찾기 불러오기</div>
                        <div style={{ fontSize: '11px', marginBottom: '12px', lineHeight: '1.6' }}>
                            <strong>"{dialog.favorite.name}"</strong> 즐겨찾기로 변경하시겠습니까?<br />
                            <span style={{ color: 'var(--vscode-editorWarning-foreground)' }}>
                                ⚠ 현재 설정된 배포목록이 즐겨찾기 세트로 교체됩니다.
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setDialog({ kind: 'none' })} style={btnStyle}>취소</button>
                            <button onClick={handleApplyConfirm} style={btnStyle}>확인</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 즐겨찾기 삭제 확인 다이얼로그 */}
            {dialog.kind === 'delete' && (
                <div style={overlayStyle}>
                    <div style={dialogBoxStyle}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px' }}>즐겨찾기 삭제</div>
                        <div style={{ fontSize: '11px', marginBottom: '12px', lineHeight: '1.6' }}>
                            <strong>"{dialog.favorite.name}"</strong> 즐겨찾기를 삭제하시겠습니까?<br />
                            <span style={{ color: 'var(--vscode-editorError-foreground)' }}>
                                이 작업은 되돌릴 수 없습니다.
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setDialog({ kind: 'none' })} style={btnStyle}>취소</button>
                            <button onClick={handleDeleteConfirm} style={btnStyle}>확인</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const btnStyle: React.CSSProperties = {
    fontSize: '11px',
    padding: '3px 10px',
    cursor: 'pointer',
    background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
    color: 'var(--vscode-button-secondaryForeground, #ccc)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '3px',
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
};

const dialogBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '4px',
    padding: '16px',
    minWidth: '260px',
    maxWidth: '340px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
};
