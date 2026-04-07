import { useState, useMemo } from 'react';

interface Props {
    xfdlFiles: string[];
    onRefresh: () => void;
    onConfirm: (selected: string[]) => void;
}

const UxStudioFilePanel: React.FC<Props> = ({ xfdlFiles, onRefresh, onConfirm }) => {
    const [keyword, setKeyword] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [confirmed, setConfirmed] = useState(false);

    // 선택되지 않은 파일 목록에서 keyword로 필터링
    const availableFiles = useMemo(() => {
        const selectedSet = new Set(selectedFiles);
        return xfdlFiles
            .filter(f => !selectedSet.has(f))
            .filter(f => !keyword || f.toLowerCase().includes(keyword.toLowerCase()));
    }, [xfdlFiles, selectedFiles, keyword]);

    const addFile = (file: string) => {
        setSelectedFiles(prev => [...prev, file].sort());
        setConfirmed(false);
    };

    const removeFile = (file: string) => {
        setSelectedFiles(prev => prev.filter(f => f !== file));
        setConfirmed(false);
    };

    const handleConfirm = () => {
        if (selectedFiles.length === 0) return;
        onConfirm(selectedFiles);
        setConfirmed(true);
    };

    const fileName = (path: string) => path.split('/').pop() ?? path;
    const dirPart = (path: string) => {
        const parts = path.split('/');
        return parts.slice(0, -1).join('/');
    };

    return (
        <div className="ux-file-panel">
            <div className="ux-file-panel__title">커스텀 작업파일 정비</div>
            <div className="ux-file-panel__desc">
                작업할 xfdl 파일을 선택하면 my-changes 폴더로 복사됩니다.
                <button className="ux-file-panel__refresh-btn" onClick={onRefresh} title="파일 목록 새로고침" aria-label="파일 목록 새로고침">
                    ↻
                </button>
            </div>

            <div className="ux-file-panel__columns">
                {/* 좌측: 전체 파일 목록 */}
                <div className="ux-file-panel__col">
                    <div className="ux-file-panel__col-label">전체 파일 목록 ({availableFiles.length})</div>
                    <input
                        className="ux-file-panel__search"
                        type="text"
                        placeholder="파일명 검색..."
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        id="ux-file-search"
                    />
                    <div className="ux-file-panel__list">
                        {availableFiles.map(file => (
                            <div
                                key={file}
                                className="ux-file-panel__item"
                                onClick={() => addFile(file)}
                                title={file}
                            >
                                <span className="ux-file-panel__item-name">{fileName(file)}</span>
                                <span className="ux-file-panel__item-dir">{dirPart(file)}</span>
                            </div>
                        ))}
                        {availableFiles.length === 0 && (
                            <div className="ux-file-panel__empty">파일 없음</div>
                        )}
                    </div>
                </div>

                {/* 우측: 선택된 파일 목록 */}
                <div className="ux-file-panel__col">
                    <div className="ux-file-panel__col-label">선택된 파일 ({selectedFiles.length})</div>
                    <div className="ux-file-panel__list ux-file-panel__list--selected">
                        {selectedFiles.map(file => (
                            <div
                                key={file}
                                className="ux-file-panel__item ux-file-panel__item--selected"
                                onClick={() => removeFile(file)}
                                title={`${file} — 클릭하면 제거됩니다`}
                            >
                                <span className="ux-file-panel__item-name">{fileName(file)}</span>
                                <span className="ux-file-panel__item-dir">{dirPart(file)}</span>
                            </div>
                        ))}
                        {selectedFiles.length === 0 && (
                            <div className="ux-file-panel__empty">선택된 파일 없음</div>
                        )}
                    </div>
                    <button
                        className={`ux-file-panel__confirm-btn${confirmed ? ' ux-file-panel__confirm-btn--done' : ''}`}
                        onClick={handleConfirm}
                        disabled={selectedFiles.length === 0}
                        id="ux-confirm-files-btn"
                    >
                        {confirmed ? '✓ 확정됨' : '확정'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UxStudioFilePanel;
