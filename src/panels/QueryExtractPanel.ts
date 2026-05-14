import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { getNonce } from '../utils/nonce';

/**
 * Query Extract 웹뷰 패널
 *
 * 기능 흐름:
 *  1. XML 파일에서 쿼리 본문 파싱 → 웹뷰(React) 초기화
 *  2. 웹뷰에서 {{변수명}} 치환값 입력 → 치환된 SQL 확인 (React 내부 처리)
 *  3. '실행' 클릭 → velocity-parser JAR 실행 → stdout 결과를 웹뷰로 전송
 */
export class QueryExtractPanel {
    public static currentPanel: QueryExtractPanel | undefined;
    private static readonly viewType = 'queryExtractor';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    // ──────────────────────────────────────────
    // Static: 패널 열기 / 재사용
    // ──────────────────────────────────────────
    public static show(
        extensionUri: vscode.Uri,
        filePath: string,
        queryId: string,
        jdkPath: string,
    ): void {
        const column = vscode.ViewColumn.Beside;

        if (QueryExtractPanel.currentPanel) {
            QueryExtractPanel.currentPanel._panel.reveal(column);
            QueryExtractPanel.currentPanel._init(extensionUri, filePath, queryId, jdkPath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            QueryExtractPanel.viewType,
            `Extract: ${queryId}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'webview-dist'),
                ],
            }
        );

        QueryExtractPanel.currentPanel = new QueryExtractPanel(
            panel,
            extensionUri,
            filePath,
            queryId,
            jdkPath,
        );
    }

    // ──────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────
    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        private _filePath: string,
        private _queryId: string,
        private _jdkPath: string,
    ) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // React 빌드 HTML 로드
        this._panel.webview.html = this._getHtml(this._panel.webview);

        // 메시지 핸들러
        this._panel.webview.onDidReceiveMessage(
            async (message: { command: string; [key: string]: unknown }) => {
                switch (message.command) {
                    case 'ready':
                        // 웹뷰가 준비되면 쿼리 데이터 전송
                        this._init(this._extensionUri, this._filePath, this._queryId, this._jdkPath);
                        break;
                    case 'runVelocityExtract':
                        await this._handleRunVelocityExtract(message.sql as string);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    // ──────────────────────────────────────────
    // 쿼리 데이터 초기화 → 웹뷰로 전송
    // ──────────────────────────────────────────
    private _init(
        _extensionUri: vscode.Uri,
        filePath: string,
        queryId: string,
        jdkPath: string,
    ): void {
        this._filePath = filePath;
        this._queryId = queryId;
        this._jdkPath = jdkPath;
        this._panel.title = `Extract: ${queryId}`;

        const { rawSql, namespace } = this._parseQuery(filePath, queryId);

        this._panel.webview.postMessage({
            command: 'init',
            queryId,
            namespace,
            rawSql,
        });
    }

    // ──────────────────────────────────────────
    // velocity-parser JAR 실행
    // ──────────────────────────────────────────
    private async _handleRunVelocityExtract(sql: string): Promise<void> {
        const jarPath = path.join(
            this._extensionUri.fsPath,
            'resources',
            'velocity-parser-1.0.0-all.jar'
        );

        if (!fs.existsSync(jarPath)) {
            this._panel.webview.postMessage({
                command: 'velocityExtractResult',
                error: `velocity-parser JAR를 찾을 수 없습니다:\n${jarPath}`,
            });
            return;
        }

        const javaExe = this._resolveJavaExe(this._jdkPath);
        if (!javaExe) {
            this._panel.webview.postMessage({
                command: 'velocityExtractResult',
                error: `JDK 경로가 설정되지 않았거나 java.exe를 찾을 수 없습니다.\n(jdkPath: "${this._jdkPath}")`,
            });
            return;
        }

        const stdinJson = JSON.stringify({ action: 'extract', template: sql });

        try {
            const output = await this._runJar(javaExe, jarPath, stdinJson);
            this._panel.webview.postMessage({
                command: 'velocityExtractResult',
                output,
            });
        } catch (e: unknown) {
            this._panel.webview.postMessage({
                command: 'velocityExtractResult',
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    /** java.exe 경로 결정 */
    private _resolveJavaExe(jdkPath: string): string | null {
        if (!jdkPath) return null;
        const candidates = [
            path.join(jdkPath, 'bin', 'java.exe'), // Windows
            path.join(jdkPath, 'bin', 'java'),      // Linux/Mac
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    /** JAR 실행 (Promise wrapping) */
    private _runJar(javaExe: string, jarPath: string, stdinJson: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = cp.spawn(javaExe, ['-jar', jarPath], {
                shell: false,
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

            proc.stdin.write(stdinJson, 'utf8');
            proc.stdin.end();

            proc.on('error', (err) => reject(new Error(`프로세스 실행 오류: ${err.message}`)));
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout || stderr); // 일부 JAR는 stderr에 출력
                } else {
                    reject(new Error(`JAR 실행 실패 (exit ${code}):\n${stderr || stdout}`));
                }
            });
        });
    }

    // ──────────────────────────────────────────
    // XML 파싱 — 쿼리 본문 추출
    // ──────────────────────────────────────────
    private _parseQuery(filePath: string, queryId: string): { rawSql: string; namespace: string } {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const nsMatch = content.match(/<mapper\s+[^>]*namespace\s*=\s*"([^"]+)"/);
            const namespace = nsMatch?.[1] || '';

            const escapedId = queryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const tagPattern = new RegExp(
                `<[Qq]uery\\s+[^>]*\\bid\\s*=\\s*"${escapedId}"[^>]*>([\\s\\S]*?)<\\/[Qq]uery>`,
                'i'
            );
            const tagMatch = content.match(tagPattern);

            if (!tagMatch) {
                return {
                    rawSql: `Query ID "${queryId}"를 찾을 수 없습니다.`,
                    namespace,
                };
            }

            let rawBody = tagMatch[1].trim();

            // <statement> 내부 추출
            const stmtMatch = rawBody.match(/<statement[^>]*>([\s\S]*?)<\/statement>/i);
            if (stmtMatch) {
                rawBody = stmtMatch[1].trim();
            }

            return { rawSql: rawBody, namespace };
        } catch (e) {
            return {
                rawSql: `파일을 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`,
                namespace: '',
            };
        }
    }

    // ──────────────────────────────────────────
    // React 빌드 HTML 로드
    // ──────────────────────────────────────────
    private _getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const distUri = vscode.Uri.joinPath(this._extensionUri, 'webview-dist');
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distUri, 'assets', 'query-extract.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(distUri, 'assets', 'index.css')
        );

        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Extract</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    // ──────────────────────────────────────────
    // Dispose
    // ──────────────────────────────────────────
    public dispose(): void {
        QueryExtractPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }
}
