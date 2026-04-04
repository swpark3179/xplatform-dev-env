interface Props {
    xprjFiles: string[];
    onLaunch: (filePath: string) => void;
}

const baseName = (filePath: string) =>
    filePath.split('/').pop()?.replace(/\.xprj$/i, '') ?? filePath;

const UxStudioLaunchPanel: React.FC<Props> = ({ xprjFiles, onLaunch }) => {
    if (xprjFiles.length === 0) {
        return (
            <div className="ux-launch-panel">
                <div className="ux-launch-panel__title">UX Studio 실행</div>
                <div className="ux-launch-panel__empty">
                    .vscode/ui-env/에 xprj 파일이 없습니다
                </div>
            </div>
        );
    }

    return (
        <div className="ux-launch-panel">
            <div className="ux-launch-panel__title">UX Studio 실행</div>
            <div className="ux-launch-panel__list">
                {xprjFiles.map(filePath => (
                    <button
                        key={filePath}
                        className="ux-launch-panel__btn"
                        onClick={() => onLaunch(filePath)}
                        id={`ux-launch-${baseName(filePath)}`}
                        title={filePath}
                    >
                        {baseName(filePath)}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default UxStudioLaunchPanel;
