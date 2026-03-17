import React, { useState, useEffect } from 'react';
import { Modal } from '../common';
import { TomcatDeployMode, TomcatState } from '@/types';
import { AppActions } from '@/hooks/useAppState';

export const TomcatInitModal: React.FC<{
    isOpen: boolean;
    initRect: DOMRect | null;
    onClose: () => void;
    tomcatState: TomcatState;
    actions: AppActions;
}> = ({ isOpen, initRect, tomcatState, actions, onClose }) => {
    const [contextRoot, setContextRoot] = useState('');
    const [profile, setProfile] = useState((tomcatState.profile) ? tomcatState.profile : 'local');
    const [isBatch, setIsBatch] = useState((tomcatState.isBatch) ? true : false);
    const [deployMode, setDeployMode] = useState<TomcatDeployMode>((tomcatState.deployMode) ? tomcatState.deployMode : 'default');

    useEffect(() => {
        if (isOpen) {
            setContextRoot(tomcatState.contextRoot || '');
            setProfile((tomcatState.profile) ? tomcatState.profile : 'local');
            setIsBatch((tomcatState.isBatch) ? true : false);
            setDeployMode((tomcatState.deployMode) ? tomcatState.deployMode : 'default');
        }
    }, [isOpen, tomcatState]);

    const getHintText = () => {
        if (contextRoot && contextRoot !== 'ROOT') return `URL: http://localhost:7001/${contextRoot}`;
        return 'URL: http://localhost:7001/';
    };

    const isConfirmDisabled = !contextRoot.trim() || !/^[a-zA-Z0-9_-]+$/.test(contextRoot.trim());

    // 확인 버튼 클릭 이벤트 (초기화 시작)
    const handleConfirm = () => {
        actions.tomcat.initTomcat(contextRoot, profile, isBatch, deployMode)
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !isConfirmDisabled) {
            handleConfirm();
        }
    };

    // calculate position based on initRect
    const position = initRect ? {
        top: 50,
        left: 0,
    } : undefined;

    return (
        <>
            <Modal
                isOpen={isOpen}
                title="Tomcat 초기화"
                onClose={onClose}
                onConfirm={handleConfirm}
                confirmText="초기화"
                confirmDisabled={isConfirmDisabled}
                position={position}
            >
                <div className="input-group">
                    <label htmlFor="modalContextRoot">컨텍스트 루트</label>
                    <input
                        type="text"
                        id="modalContextRoot"
                        value={contextRoot}
                        onChange={(e) => setContextRoot(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="서브시스템 Context Root (예: ep)"
                        autoFocus
                    />
                    <small className="input-hint">{getHintText()}</small>
                </div>

                <div className="input-group" style={{ marginTop: '1rem' }}>
                    <label>프로파일 설정</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '5px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <input
                                type="radio"
                                name="profileSetting"
                                value="local"
                                checked={profile === 'local'}
                                onChange={() => setProfile('local')}
                            />
                            local
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <input
                                type="radio"
                                name="profileSetting"
                                value="localqa"
                                checked={profile === 'localqa'}
                                onChange={() => setProfile('localqa')}
                            />
                            localqa
                        </label>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', margin: 0 }}>
                        <input type="checkbox" checked={isBatch} onChange={e => setIsBatch(e.target.checked)} />
                        <span>(Batch 포함)</span>
                    </label>
                </div>

                <div className="input-group" style={{ marginTop: '1rem' }}>
                    <label>배포 모드 설정</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '5px' }}></div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <input
                            type="radio"
                            name="deployMode"
                            value="default"
                            checked={deployMode === 'default'}
                            onChange={() => setDeployMode('default')}
                        />
                        기본 모드
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <input
                            type="radio"
                            name="deployMode"
                            value="selected"
                            checked={deployMode === 'selected'}
                            onChange={() => setDeployMode('selected')}
                        />
                        선택된 파일만 배포
                    </label>
                </div>
            </Modal>
        </>
    );
};
