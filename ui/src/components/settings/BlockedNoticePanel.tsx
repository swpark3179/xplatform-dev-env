import React from 'react';
import { Button } from '../common';

export const BlockedNoticePanel: React.FC<{ onOpenFolder: () => void }> = ({ onOpenFolder }) => {
    return (
        <div className="panel blocked-notice">
            <div className="blocked-notice__icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
            </div>
            <div className="blocked-notice__title">이 프로젝트에서는 사용할 수 없습니다</div>
            <div className="blocked-notice__desc">XPlatform 프로젝트가 아닙니다.</div>
            <Button variant="secondary" className="blocked-notice__action" onClick={onOpenFolder}>
                다른 폴더 열기
            </Button>
        </div>
    );
};
