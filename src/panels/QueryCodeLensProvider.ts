import * as vscode from 'vscode';

/**
 * Query XML 파일의 <query id="..."> 태그 위에 CodeLens 버튼을 표시하는 프로바이더.
 *
 * DocumentLink + command: URI 방식은 VS Code 버전에 따라 실행이 차단되는 문제가 있어,
 * CodeLens를 통해 명령을 직접 실행하는 방식으로 변경합니다.
 * (ctrl+클릭 불필요 — 일반 클릭으로 동작)
 */
export class QueryCodeLensProvider implements vscode.CodeLensProvider {
    private static readonly QUERY_TAG_REGEX =
        /<[Qq]uery\s+[^>]*\bid\s*=\s*"([^"]+)"/gi;

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const regex = new RegExp(QueryCodeLensProvider.QUERY_TAG_REGEX.source, 'gi');

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const queryId = match[1];

            // CodeLens 는 매칭된 라인 맨 앞에 표시
            const matchPos = document.positionAt(match.index);
            const lineStart = new vscode.Position(matchPos.line, 0);
            const range = new vscode.Range(lineStart, lineStart);

            lenses.push(
                new vscode.CodeLens(range, {
                    title: `⚡ Extract: ${queryId}`,
                    command: 'dev-helper.openQueryExtract',
                    arguments: [{ filePath: document.uri.fsPath, queryId }],
                    tooltip: 'Query Extract 패널 열기 (SQL 상세 + 분석)',
                }),
            );
        }

        return lenses;
    }
}
