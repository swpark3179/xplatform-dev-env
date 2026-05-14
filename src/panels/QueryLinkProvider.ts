import * as vscode from 'vscode';

/**
 * Query XML 파일에서 <query ...> 태그 전체에 Ctrl+클릭 링크를 제공하는 DocumentLinkProvider.
 *
 * 주의: DocumentLink + command: URI 방식은 VS Code 버전에 따라 실행이 차단될 수 있습니다.
 * 실질적인 명령 실행은 QueryCodeLensProvider의 CodeLens 버튼이 담당하며,
 * 이 프로바이더는 hover 시 언더라인 시각적 피드백을 제공하는 보조 역할을 합니다.
 */
export class QueryLinkProvider implements vscode.DocumentLinkProvider {

    // <query id="queryId" ...> 또는 <Query id="queryId" ...> 패턴
    private static readonly QUERY_TAG_REGEX =
        /<[Qq]uery\s+[^>]*\bid\s*=\s*"([^"]+)"/gi;

    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        const regex = new RegExp(QueryLinkProvider.QUERY_TAG_REGEX.source, 'gi');

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const idValue = match[1];

            // 링크 범위: 매칭된 <query ...> 전체 (id 값만이 아닌 태그 전체)
            // 이를 통해 태그 어디를 클릭해도 링크가 트리거됨
            const tagStart = match.index;
            let tagEnd = tagStart + match[0].length;

            // 태그 닫는 '>' 까지 범위 확장
            while (tagEnd < text.length && text[tagEnd] !== '>' && text[tagEnd] !== '\n') {
                tagEnd++;
            }
            if (tagEnd < text.length && text[tagEnd] === '>') {
                tagEnd++; // '>' 포함
            }

            const startPos = document.positionAt(tagStart);
            const endPos = document.positionAt(tagEnd);
            const range = new vscode.Range(startPos, endPos);

            const commandUri = vscode.Uri.parse(
                `command:dev-helper.openQueryExtract?${encodeURIComponent(
                    JSON.stringify({ filePath: document.uri.fsPath, queryId: idValue }),
                )}`,
            );

            const link = new vscode.DocumentLink(range, commandUri);
            link.tooltip = `Query Extract: ${idValue} (클릭)`;
            links.push(link);
        }

        return links;
    }
}
