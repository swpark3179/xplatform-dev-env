import * as vscode from 'vscode';
import { RefNode, RefGraphData, RefNodeType } from '../types/referenceTypes';

/** 분석 대상 패키지 접두어 */
const TARGET_PACKAGE_PREFIXES = ['com.shi', 'com.diablo', 'com.sample'];

/** 재귀 최대 깊이 */
const MAX_DEPTH = 15;

/** 시작점 유형 */
export type StartPointKind = 'method' | 'class';

/** analyzeAtCursor 의 최종 반환 타입 (하위 호환) */
export interface AnalysisResult {
    direction: 'outbound' | 'inbound';
    startLabel: string;
    items: { label: string; uri: vscode.Uri; range: vscode.Range }[];
    warning?: string;
}

export class ReferenceAnalysisProvider {

    // ─────────────────────────────────────────────
    // 공개 진입점 (그래프 분석)
    // ─────────────────────────────────────────────

    /**
     * 현재 에디터의 커서 위치를 분석해 양방향 재귀 참조 그래프를 반환합니다.
     */
    async analyzeGraphAtCursor(editor: vscode.TextEditor): Promise<RefGraphData | undefined> {
        const document = editor.document;
        const position = editor.selection.active;

        // 시작점 찾기 : 에디터의 커서 위치가 클래스나 메서드 블록 내부에 있는지 확인하여 시작점 얻기
        const startPoint = await this._resolveStartPoint(document, position);
        if (!startPoint) {
            vscode.window.showInformationMessage('SHI 참조관계 분석: 커서가 클래스나 메서드 블록 내부에 있지 않습니다.');
            return undefined;
        }

        const { symbol, className } = startPoint;
        const rootId = `${document.uri.fsPath}::${className}#${symbol.name}`;
        const rootLabel = startPoint.kind === 'method' ? `${className}#${symbol.name}` : className;

        const rootNode: RefNode = {
            id: rootId,
            label: rootLabel,
            nodeType: 'method',
            uri: document.uri.toString(),
            line: symbol.selectionRange.start.line,
            character: symbol.selectionRange.start.character,
            outbound: [],
            inbound: [],
            isRoot: true,
        };

        // 방문 집합 (순환 참조 방지)
        const outboundVisited = new Set<string>([rootId]);
        const inboundVisited = new Set<string>([rootId]);

        // 아웃바운드 재귀 빌드
        if (startPoint.kind === 'method') {
            const callItems = await this._prepareCallHierarchy(document.uri, symbol.selectionRange.start);
            if (callItems && callItems.length > 0) {
                rootNode.outbound = await this._buildOutboundTree(
                    callItems[0], document, symbol, outboundVisited, 0
                );
            }
        }

        // 인바운드 재귀 빌드
        rootNode.inbound = await this._buildInboundTree(
            document.uri, symbol, className, inboundVisited, 0
        );

        return {
            root: rootNode,
            startLabel: rootLabel,
        };
    }

    // ─────────────────────────────────────────────
    // 아웃바운드 재귀 트리 빌드
    // ─────────────────────────────────────────────

    private async _buildOutboundTree(
        callItem: vscode.CallHierarchyItem,
        parentDocument: vscode.TextDocument,
        methodSymbol: vscode.DocumentSymbol,
        visited: Set<string>,
        depth: number
    ): Promise<RefNode[]> {
        if (depth >= MAX_DEPTH) {
            return [];
        }

        let outgoingCalls: vscode.CallHierarchyOutgoingCall[] = [];
        try {
            outgoingCalls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                'vscode.provideOutgoingCalls',
                callItem
            ) ?? [];
        } catch {
            return [];
        }

        // DAO 쿼리 호출 감지
        const daoNodes = this._detectDaoQueryCalls(parentDocument, methodSymbol.range);
        const children: RefNode[] = [...daoNodes];

        const childPromises = outgoingCalls.map(async (call) => {
            const target = call.to;
            if (!this._isTargetPackageByUri(target.uri)) {
                return null;
            }

            const targetLabel = this._buildLabel(target);
            const nodeId = `${target.uri.fsPath}::${targetLabel}`;

            if (visited.has(nodeId)) {
                return {
                    id: nodeId,
                    label: targetLabel,
                    nodeType: 'method',
                    uri: target.uri.toString(),
                    line: target.selectionRange.start.line,
                    character: target.selectionRange.start.character,
                    outbound: [],
                    inbound: [],
                    isCyclic: true,
                } as RefNode;
            }

            visited.add(nodeId);

            const node: RefNode = {
                id: nodeId,
                label: targetLabel,
                nodeType: 'method',
                uri: target.uri.toString(),
                line: target.selectionRange.start.line,
                character: target.selectionRange.start.character,
                outbound: [],
                inbound: [],
            };

            // 자식 아웃바운드 재귀 준비: 타겟의 CallHierarchyItem을 다시 prepare
            try {
                const targetDocument = await vscode.workspace.openTextDocument(target.uri);
                const targetCallItems = await this._prepareCallHierarchy(target.uri, target.selectionRange.start);
                if (targetCallItems && targetCallItems.length > 0) {
                    // 대상 메서드의 DocumentSymbol 탐색 (DAO 감지용)
                    const targetSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        'vscode.executeDocumentSymbolProvider',
                        target.uri
                    ) ?? [];
                    const targetMethodSymbol = this._findMethodSymbol(targetSymbols, target.selectionRange.start);

                    node.outbound = await this._buildOutboundTree(
                        targetCallItems[0],
                        targetDocument,
                        targetMethodSymbol ?? { range: target.range, selectionRange: target.selectionRange } as vscode.DocumentSymbol,
                        visited,
                        depth + 1
                    );
                }
            } catch {
                // 탐색 실패 시 빈 children 유지
            }

            return node;
        });

        const resolvedChildren = await Promise.all(childPromises);
        for (const child of resolvedChildren) {
            if (child) {
                children.push(child);
            }
        }

        return children;
    }

    // ─────────────────────────────────────────────
    // 인바운드 재귀 트리 빌드
    // ─────────────────────────────────────────────

    private async _buildInboundTree(
        uri: vscode.Uri,
        symbol: vscode.DocumentSymbol,
        className: string,
        visited: Set<string>,
        depth: number
    ): Promise<RefNode[]> {
        if (depth >= MAX_DEPTH) {
            return [];
        }

        const pos = symbol.selectionRange.start;
        let locations: vscode.Location[] = [];
        try {
            locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                pos
            ) ?? [];
        } catch {
            return [];
        }

        const seen = new Set<string>();
        const parents: RefNode[] = [];

        const parentPromises = locations.map(async (loc) => {
            // 자신의 선언부 제외
            if (loc.uri.fsPath === uri.fsPath && loc.range.start.line === pos.line) {
                return null;
            }
            if (!this._isTargetPackageByUri(loc.uri)) {
                return null;
            }

            let refSymbols: vscode.DocumentSymbol[] = [];
            try {
                refSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    loc.uri
                ) ?? [];
            } catch {
                return null;
            }

            const enclosing = this._findEnclosingSymbol(refSymbols, loc.range.start);
            if (!enclosing) { return null; }

            const nodeId = `${loc.uri.fsPath}::${enclosing.label}`;
            if (visited.has(nodeId)) {
                return {
                    id: nodeId,
                    label: enclosing.label,
                    nodeType: 'method',
                    uri: loc.uri.toString(),
                    line: enclosing.range.start.line,
                    character: enclosing.range.start.character,
                    outbound: [],
                    inbound: [],
                    isCyclic: true,
                } as RefNode;
            }
            if (seen.has(nodeId)) { return null; }
            seen.add(nodeId);
            visited.add(nodeId);

            const node: RefNode = {
                id: nodeId,
                label: enclosing.label,
                nodeType: 'method',
                uri: loc.uri.toString(),
                line: enclosing.range.start.line,
                character: enclosing.range.start.character,
                outbound: [],
                inbound: [],
            };

            // 상위 인바운드 재귀
            try {
                const enclosingSymbol = this._findMethodSymbolByLabel(refSymbols, enclosing.label);
                const enclosingClass = enclosing.label.split('#')[0];
                if (enclosingSymbol) {
                    node.inbound = await this._buildInboundTree(
                        loc.uri,
                        enclosingSymbol,
                        enclosingClass,
                        visited,
                        depth + 1
                    );
                }
            } catch {
                // 실패 시 빈 inbound 유지
            }

            return node;
        });

        const resolvedParents = await Promise.all(parentPromises);
        for (const parent of resolvedParents) {
            if (parent) {
                parents.push(parent);
            }
        }

        return parents;
    }

    // ─────────────────────────────────────────────
    // DAO 쿼리 감지
    // ─────────────────────────────────────────────

    /**
     * 메서드 소스 텍스트에서 DAO 쿼리 호출 패턴을 감지합니다.
     * 감지 대상: \w*[dD]ao\w*\.(select|update|insert|delete|get|execute|save)("queryId", ...)
     */
    private _detectDaoQueryCalls(document: vscode.TextDocument, methodRange: vscode.Range): RefNode[] {
        const text = document.getText(methodRange);
        const results: RefNode[] = [];
        const seen = new Set<string>();

        // methodRange 시작점의 절대 오프셋 (match.index 를 절대 위치로 환산하기 위함)
        const baseOffset = document.offsetAt(methodRange.start);

        // 정규식: dao 또는 Dao를 포함하는 변수명 + 메서드 + 첫 번째 문자열 인수
        const daoPattern = /\b(\w*[dD]ao\w*)\s*\.\s*(select|update|insert|delete|get|execute|save)\s*\(\s*"([^"]+)"/g;
        let match: RegExpExecArray | null;

        while ((match = daoPattern.exec(text)) !== null) {
            const queryId = match[3];
            const nodeId = `query::${queryId}`;
            if (seen.has(nodeId)) { continue; }
            seen.add(nodeId);

            // 매치 시작 위치를 문서 내 절대 Position 으로 변환
            const matchPos = document.positionAt(baseOffset + match.index);

            results.push({
                id: nodeId,
                label: queryId,
                nodeType: 'query',
                uri: document.uri.toString(),
                line: matchPos.line,
                character: matchPos.character,
                outbound: [],
                inbound: [],
            });
        }

        return results;
    }

    // ─────────────────────────────────────────────
    // 헬퍼 메서드
    // ─────────────────────────────────────────────

    private async _prepareCallHierarchy(
        uri: vscode.Uri,
        position: vscode.Position
    ): Promise<vscode.CallHierarchyItem[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                uri,
                position
            );
        } catch {
            return undefined;
        }
    }

    private async _resolveStartPoint(document: vscode.TextDocument, position: vscode.Position): Promise<{ kind: StartPointKind; symbol: vscode.DocumentSymbol; className: string } | undefined> {
        let symbols: vscode.DocumentSymbol[];
        try {
            symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri) ?? [];
        } catch { return undefined; }
        if (!symbols || symbols.length === 0) return undefined;

        for (const topSymbol of symbols) {
            if (!this._isClassLike(topSymbol.kind)) { continue; }
            if (!topSymbol.range.contains(position)) { continue; }

            for (const child of topSymbol.children) {
                if (child.kind === vscode.SymbolKind.Method ||
                    child.kind === vscode.SymbolKind.Constructor ||
                    child.kind === vscode.SymbolKind.Function) {
                    if (child.range.contains(position)) {
                        return { kind: 'method', symbol: child, className: topSymbol.name };
                    }
                }
            }
            return { kind: 'class', symbol: topSymbol, className: topSymbol.name };
        }

        return undefined;
    }

    private _isClassLike(kind: vscode.SymbolKind): boolean {
        return kind === vscode.SymbolKind.Class
            || kind === vscode.SymbolKind.Interface
            || kind === vscode.SymbolKind.Enum;
    }

    private _buildLabel(item: vscode.CallHierarchyItem): string {
        const pkg = item.detail
            ? item.detail.replace(/\//g, '.').replace(/\.java$/i, '')
            : '';
        return pkg ? `${pkg}.${item.name}` : item.name;
    }

    private _findEnclosingSymbol(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position
    ): { label: string; range: vscode.Range } | undefined {
        for (const sym of symbols) {
            if (!sym.range.contains(position)) { continue; }
            if (this._isClassLike(sym.kind)) {
                for (const child of sym.children) {
                    if ((child.kind === vscode.SymbolKind.Method ||
                        child.kind === vscode.SymbolKind.Constructor ||
                        child.kind === vscode.SymbolKind.Function)
                        && child.range.contains(position)) {
                        return { label: `${sym.name}#${child.name}`, range: child.selectionRange };
                    }
                }
                return { label: sym.name, range: sym.selectionRange };
            }
        }
        return undefined;
    }

    private _findMethodSymbol(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position
    ): vscode.DocumentSymbol | undefined {
        for (const sym of symbols) {
            if (!this._isClassLike(sym.kind)) { continue; }
            for (const child of sym.children) {
                if ((child.kind === vscode.SymbolKind.Method ||
                    child.kind === vscode.SymbolKind.Constructor ||
                    child.kind === vscode.SymbolKind.Function)
                    && child.selectionRange.start.line === position.line) {
                    return child;
                }
            }
        }
        return undefined;
    }

    private _findMethodSymbolByLabel(
        symbols: vscode.DocumentSymbol[],
        label: string
    ): vscode.DocumentSymbol | undefined {
        const parts = label.split('#');
        const className = parts[0];
        const methodName = parts[1];

        for (const sym of symbols) {
            if (!this._isClassLike(sym.kind) || sym.name !== className) { continue; }
            if (!methodName) { return sym; }
            for (const child of sym.children) {
                if (child.name === methodName) { return child; }
            }
        }
        return undefined;
    }

    private _isTargetPackageByUri(uri: vscode.Uri): boolean {
        const normalized = uri.fsPath.replace(/\\/g, '/');
        return TARGET_PACKAGE_PREFIXES.some(pkg => {
            const pathFragment = pkg.replace(/\./g, '/');
            return normalized.includes(`/${pathFragment}/`);
        });
    }
}
