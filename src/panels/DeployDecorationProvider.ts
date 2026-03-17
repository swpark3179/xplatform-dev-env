import * as vscode from 'vscode';

// 소스 트리 창에서 뱃지, 파일 색상 등 장식을 위한 서비스
export class DeployDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    constructor(private checkIsTarget: (fsPath: string) => boolean) {}

    // VS Code가 파일마다 이 함수를 호출함. 배포대상 파일인지 확인하여 장식을 추가함.
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (this.checkIsTarget(uri.fsPath)) {
            return {
                badge: '🚀',
                tooltip: 'SHI 배포 대상 파일입니다.',
                color: new vscode.ThemeColor('charts.green'), // 초록색으로 표시
                // propagate: true // (선택) 폴더인 경우 하위 파일까지 전파할지 여부
            };
        }
        return undefined; // 대상이 아니면 아무것도 안 함 (undefined 리턴)
    }

    // 외부에서 호출하여 화면 장식을 갱신
    refresh(uris: vscode.Uri | vscode.Uri[]) {
        this._onDidChangeFileDecorations.fire(uris);
    }
}