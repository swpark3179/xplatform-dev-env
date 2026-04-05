import * as vscode from 'vscode';

/**
 * Query XML 파일에서 <query> 또는 <Query> 태그의 id 속성값에
 * Ctrl+클릭 가능한 링크를 제공하는 DocumentLinkProvider
 */
export class QueryLinkProvider implements vscode.DocumentLinkProvider {

    // <query id="queryId" ...> 또는 <Query id="queryId" ...> 패턴
    private static readonly QUERY_ID_REGEX = /<[Qq]uery\s+[^>]*\bid\s*=\s*"([^"]+)"/gi;

    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();
        const regex = new RegExp(QueryLinkProvider.QUERY_ID_REGEX.source, 'gi');

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const idValue = match[1]; // query id 값
            // id="..." 부분에서 id 값의 위치를 찾기
            const fullMatch = match[0];
            const idAttrMatch = fullMatch.match(/\bid\s*=\s*"([^"]+)"/);
            if (!idAttrMatch) continue;

            const idAttrIndex = fullMatch.indexOf(idAttrMatch[0]);
            const idValueOffset = idAttrMatch[0].indexOf(idAttrMatch[1]);
            const startOffset = match.index + idAttrIndex + idValueOffset;
            const endOffset = startOffset + idValue.length;

            const startPos = document.positionAt(startOffset);
            const endPos = document.positionAt(endOffset);
            const range = new vscode.Range(startPos, endPos);

            // 커스텀 명령어 URI: dev-helper.openQueryExtract 호출
            const commandUri = vscode.Uri.parse(
                `command:dev-helper.openQueryExtract?${encodeURIComponent(JSON.stringify({
                    filePath: document.uri.fsPath,
                    queryId: idValue,
                }))}`
            );

            const link = new vscode.DocumentLink(range, commandUri);
            link.tooltip = `Query Extract: ${idValue}`;
            links.push(link);
        }

        return links;
    }
}
