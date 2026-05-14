import * as vscode from 'vscode';
import { UnifiedPanelProvider } from './panels';
import { DeployDecorationProvider } from './panels/DeployDecorationProvider';
import { QueryLinkProvider } from './panels/QueryLinkProvider';
import { QueryCodeLensProvider } from './panels/QueryCodeLensProvider';
import { QueryViewerPanel } from './panels/QueryViewerPanel';
import { QueryExtractPanel } from './panels/QueryExtractPanel';
import { ReferenceAnalysisProvider } from './panels/ReferenceAnalysisProvider';
import { ReferenceGraphPanel } from './panels/ReferenceGraphPanel';

export function activate(context: vscode.ExtensionContext) {
    // 통합 패널 프로바이더 생성
    const panelProvider = new UnifiedPanelProvider(context.extensionUri, context);

    // Webview 뷰 프로바이더 등록
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'dev-helper.settingsView',
            panelProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
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

    // Query XML 파일에서 <query id="..."> 태그에 CodeLens 버튼 표시
    // DocumentLink + command: URI 방식은 VS Code 버전에 따라 차단될 수 있어
    // CodeLens 방식으로 직접 명령 실행 (일반 클릭으로 동작, ctrl 불필요)
    const queryCodeLensProvider = vscode.languages.registerCodeLensProvider(
        { scheme: 'file', pattern: '**/*.xml' },
        new QueryCodeLensProvider()
    );

    // DocumentLink 는 보조 수단으로 유지 (hover 언더라인 시각적 피드백)
    const queryLinkProvider = vscode.languages.registerDocumentLinkProvider(
        { scheme: 'file', pattern: '**/*.xml' },
        new QueryLinkProvider()
    );

    // Query Viewer 명령어 등록 (기존 유지)
    const openQueryViewerCommand = vscode.commands.registerCommand(
        'dev-helper.openQueryViewer',
        (args: { filePath: string; queryId: string }) => {
            QueryViewerPanel.show(context.extensionUri, args.filePath, args.queryId);
        }
    );

    // Query Extract 명령어 등록 (Ctrl+클릭 → React 기반 패널)
    const openQueryExtractCommand = vscode.commands.registerCommand(
        'dev-helper.openQueryExtract',
        (args: { filePath: string; queryId: string }) => {
            // jdkPath는 panelProvider가 관리하는 settings에서 동적으로 읽음
            const jdkPath: string = panelProvider.getJdkPath?.() ?? '';
            QueryExtractPanel.show(
                context.extensionUri,
                args.filePath,
                args.queryId,
                jdkPath,
            );
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
        queryCodeLensProvider,
        queryLinkProvider,
        openQueryViewerCommand,
        openQueryExtractCommand,
        analyzeReferenceCommand
    );
}

export function deactivate() { }

