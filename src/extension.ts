import * as vscode from 'vscode';
import { UnifiedPanelProvider } from './panels';
import { DeployDecorationProvider } from './panels/DeployDecorationProvider';
import { QueryLinkProvider } from './panels/QueryLinkProvider';
import { QueryViewerPanel } from './panels/QueryViewerPanel';
import { ReferenceAnalysisProvider } from './panels/ReferenceAnalysisProvider';
import { ReferenceGraphPanel } from './panels/ReferenceGraphPanel';

export function activate(context: vscode.ExtensionContext) {
    // 통합 패널 프로바이더 생성
    const panelProvider = new UnifiedPanelProvider(context.extensionUri, context);

    // Webview 뷰 프로바이더 등록
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'dev-helper.settingsView',
            panelProvider
        )
    );

    // 화면 장식을 위한 프로바이더 생성
    const decorationProvider = new DeployDecorationProvider((path) => {
        return panelProvider.hasDeployTargetFile(path);
    });

    // 화면 장식 프로바이더 등록
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider)
    );

    panelProvider.setOnDeployListChanged(uri => decorationProvider.refresh(uri));

    // 설정 패널 표시 명령어 등록
    const showSettingsCommand = vscode.commands.registerCommand(
        'dev-helper.showSettings',
        () => {
            vscode.commands.executeCommand('workbench.view.extension.xplatform-sidebar');
        }
    );

    // 배포 대상 추가 명령어 등록. 소스 목록창에서 우클릭 또는 편집기 타이틀에서 우클릭 시 나타나는 컨텍스트 메뉴 맨 아래에 표시되는 'SHI 배포대상에 포함' 기능
    const includeInDeployTargetCommand = vscode.commands.registerCommand('dev-helper.includeInSHIDeployTarget',
        (uri?: vscode.Uri) => {
            let targetUri = uri;
            if (!targetUri && vscode.window.activeTextEditor) {
                targetUri = vscode.window.activeTextEditor.document.uri;
            }
            if (targetUri) {
                panelProvider.addDeployTargetFile(targetUri.fsPath);
            }
        }
    );

    // Query XML 파일에서 Query ID Ctrl+클릭 링크 제공
    const queryLinkProvider = vscode.languages.registerDocumentLinkProvider(
        { scheme: 'file', language: 'xml' },
        new QueryLinkProvider()
    );

    // Query Viewer 명령어 등록
    const openQueryViewerCommand = vscode.commands.registerCommand(
        'dev-helper.openQueryViewer',
        (args: { filePath: string; queryId: string }) => {
            QueryViewerPanel.show(context.extensionUri, args.filePath, args.queryId);
        }
    );

    // SHI: 참조관계 분석 명령어 등록
    const referenceAnalysisProvider = new ReferenceAnalysisProvider();
    const analyzeReferenceCommand = vscode.commands.registerCommand(
        'dev-helper.analyzeReference',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('SHI 참조관계 분석: 활성 편집기가 없습니다.');
                return;
            }
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'SHI: 참조관계 분석 중...',
                    cancellable: false
                },
                async () => {
                    const result = await referenceAnalysisProvider.analyzeGraphAtCursor(editor);
                    if (result) {
                        ReferenceGraphPanel.show(result, context.extensionUri);
                    }
                }
            );
        }
    );

    context.subscriptions.push(
        showSettingsCommand,
        includeInDeployTargetCommand,
        queryLinkProvider,
        openQueryViewerCommand,
        analyzeReferenceCommand
    );
}

export function deactivate() { }

