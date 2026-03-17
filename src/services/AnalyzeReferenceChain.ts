import * as vscode from 'vscode';

// 배포목록관리 팝업에서 참조 파일 자동 추가를 위한 서비스
export class AnalyzeReferenceChain {
    // 특정 파일의 모든 메서드에서 호출하는 대상 파일 경로 Set을 얻어낸다.
    async analyzeOutboundFromFile(fileUri: vscode.Uri): Promise<Set<string>> {
        const result = new Set<string>()
        // 1. 현재 파일의 모든 심볼을 추출
        const symbols = await this._getSymbols(fileUri);
        for (const topSymbol of symbols) {
            if (!this._isClassLike(topSymbol.kind)) { continue; } // 심볼이 클래스 유형일 경우에만 처리 시작
            // 2. 현재 파일의 클래스에서 모든 메서드를 추출
            const methods = topSymbol.children.filter(c => c.kind === vscode.SymbolKind.Method || c.kind === vscode.SymbolKind.Constructor || c.kind === vscode.SymbolKind.Function);
            for (const method of methods) {
                const pos = method.selectionRange.start;
                // 3. 메서드 내부에서 호출하는 메서드를 추출
                const outgoingCalls = await this._getOutgoingCalls(fileUri, pos);
                for (const call of outgoingCalls) {
                    // 4. 참조대상이 현재 프로젝트 내의 파일이라면 (라이브러리 아님) 결과에 추가
                    if (call.to.uri.scheme === 'file') {
                        result.add(call.to.uri.fsPath.replace(/\\/g, '/'));
                    }
                }
            }
        }
        return result;
    }

    // 파일 uri 정보를 파라미터로 넣어서 해당 파일 내 모든 객체를 얻어낸다.
    private async _getSymbols(fileUri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
        try {
            return await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', fileUri) ?? [];
        }
        catch {
            return [];
        }
    }

    private _isClassLike(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Class
            || kind === vscode.SymbolKind.Interface
            || kind === vscode.SymbolKind.Enum;
    }

    // 특정 파일의 특정 위치가 속한 블록에서 호출하는 대상 목록을 얻어낸다.
    private async _getOutgoingCalls(fileUri: vscode.Uri, pos: vscode.Position): Promise<vscode.CallHierarchyOutgoingCall[]> {
        try {
            // 호출자의 정보를 우선 파악한다. (그래야 파라미터로 입력 가능)
            const callItems = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', fileUri, pos) ?? [];
            // 호출자의 정보를 파라미터로 넣어서 호출 대상을 얻어낸다.
            return await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', callItems[0]) ?? [];
        } catch {
            return [];
        }
    }
}