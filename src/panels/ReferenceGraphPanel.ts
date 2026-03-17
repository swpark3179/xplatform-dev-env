import * as vscode from 'vscode';
import { RefGraphData, RefNode } from '../types/referenceTypes';

export class ReferenceGraphPanel {
    private static _panel: vscode.WebviewPanel | undefined;

    /**
     * 참조 그래프 패널을 표시합니다.
     */
    static show(data: RefGraphData, extensionUri: vscode.Uri): void {
        if (ReferenceGraphPanel._panel) {
            ReferenceGraphPanel._panel.reveal(vscode.ViewColumn.Beside);
        } else {
            ReferenceGraphPanel._panel = vscode.window.createWebviewPanel(
                'referenceGraph',
                'SHI: 참조관계 그래프',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                }
            );

            ReferenceGraphPanel._panel.onDidDispose(() => {
                ReferenceGraphPanel._panel = undefined;
            });
        }

        const panel = ReferenceGraphPanel._panel;

        // 메시지 수신 (노드 클릭 → 파일 열기)
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'openFile') {
                try {
                    const uri = vscode.Uri.parse(message.uri);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
                    const line = message.line ?? 0;
                    const character = message.character ?? 0;
                    const pos = new vscode.Position(line, character);
                    editor.selection = new vscode.Selection(pos, pos);
                    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`파일 열기 실패: ${e?.message ?? String(e)}`);
                }
            }
        });

        panel.webview.html = ReferenceGraphPanel._buildHtml(data);
    }

    // ─────────────────────────────────────────────
    // HTML 생성
    // ─────────────────────────────────────────────

    private static _buildHtml(data: RefGraphData): string {
        const elements = ReferenceGraphPanel._buildCytoscapeElements(data.root);
        const elementsJson = JSON.stringify(elements);
        const warningHtml = data.warning
            ? `<div class="warning">⚠️ ${data.warning}</div>`
            : '';

        return /* html */`<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SHI: 참조관계 그래프 - ${data.startLabel}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family), 'Segoe UI', 'Noto Sans KR', sans-serif;
            font-size: var(--vscode-font-size);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
            margin: 0;
        }

        /* 헤더 */
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 16px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
        }
        .header-actions {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }
        .btn {
            padding: 4px 10px;
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 2px;
            background-color: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
            color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
            font-size: 11px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .btn:hover { background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }

        /* 범례 */
        .legend {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 6px 16px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border, #444);
            flex-shrink: 0;
            flex-wrap: wrap;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #ccc);
        }
        .legend-dot {
            width: 12px; height: 12px;
            border-radius: 3px;
            border: 1.5px solid;
        }

        /* 경고 */
        .warning {
            padding: 6px 16px;
            background-color: var(--vscode-inputValidation-warningBackground, #5a4a00);
            color: var(--vscode-inputValidation-warningForeground, #cccccc);
            border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #ffcc00);
            font-size: 12px;
        }

        /* 그래프 컨테이너 */
        #cy {
            flex: 1;
            width: 100%;
            background-color: transparent;
        }

        /* 툴팁 */
        #tooltip {
            position: fixed;
            background-color: var(--vscode-editorHoverWidget-background, #252526);
            color: var(--vscode-editorHoverWidget-foreground, #cccccc);
            border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s;
            max-width: 320px;
            word-break: break-all;
            z-index: 999;
            box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,0.36));
        }
        #tooltip.visible { opacity: 1; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 참조관계 그래프: <strong>${data.startLabel}</strong></h1>
        <div class="header-actions">
            <button class="btn" id="btnFit">전체 보기</button>
            <button class="btn" id="btnZoomIn">＋</button>
            <button class="btn" id="btnZoomOut">－</button>
        </div>
    </div>
    <div class="legend" id="dynamic-legend">
        <!-- 테마에 맞게 스크립트에서 자동 생성됨 -->
    </div>
    ${warningHtml}
    <div id="cy"></div>
    <div id="tooltip"></div>

    <script>
        const vscode = acquireVsCodeApi();
        const elements = ${elementsJson};

        // dagre 레이아웃 플러그인 등록
        if (typeof cytoscapeDagre !== 'undefined') {
            cytoscape.use(cytoscapeDagre);
        }

        // 테마 동적 감지 및 색상 변수 설정
        const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
        
        const colors = {
            fg: isDark ? '#D4D4D4' : '#333333',
            nodeBg: isDark ? '#2D2D30' : '#F3F3F3',
            nodeBorder: isDark ? '#007ACC' : '#007ACC',
            rootBg: isDark ? '#4D4D00' : '#FFFACD',
            rootBorder: isDark ? '#D7BA7D' : '#D08770',
            queryBg: isDark ? '#0F4D0F' : '#E6F4EA',
            queryBorder: isDark ? '#4CAF50' : '#34A853',
            cyclicBg: isDark ? '#5A1D1D' : '#FCE8E6',
            cyclicBorder: isDark ? '#F44336' : '#EA4335',
            cyclicText: isDark ? '#F48771' : '#C5221F',
            edgeOut: isDark ? '#569CD6' : '#007ACC',
            edgeIn: isDark ? '#C586C0' : '#B48EAD',
            hoverFocus: isDark ? '#007ACC' : '#007ACC'
        };

        // 동적 범례 렌더링
        const legendContainer = document.getElementById('dynamic-legend');
        legendContainer.innerHTML = \`
            <span class="legend-item"><span class="legend-dot" style="background:\${colors.rootBg};border-color:\${colors.rootBorder};"></span>선택 노드</span>
            <span class="legend-item"><span class="legend-dot" style="background:\${colors.nodeBg};border-color:\${colors.nodeBorder};"></span>메서드</span>
            <span class="legend-item"><span class="legend-dot" style="background:\${colors.queryBg};border-color:\${colors.queryBorder};border-radius:50%;"></span>쿼리 (DAO)</span>
            <span class="legend-item"><span class="legend-dot" style="background:\${colors.cyclicBg};border-color:\${colors.cyclicBorder};border-style:dashed;"></span>순환 참조</span>
            <span class="legend-item" style="color:\${colors.edgeOut};">← 인바운드(\${colors.edgeIn}) &nbsp; 아웃바운드(\${colors.edgeOut}) →</span>
        \`;

        const cy = cytoscape({
            container: document.getElementById('cy'),
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(shortLabel)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-size': '11px',
                        'font-family': 'var(--vscode-font-family), sans-serif',
                        'color': colors.fg,
                        'background-color': colors.nodeBg,
                        'border-color': colors.nodeBorder,
                        'border-width': 1.5,
                        'width': 'label',
                        'height': 28,
                        'padding': '8px',
                        'shape': 'round-rectangle',
                        'text-wrap': 'wrap',
                        'text-max-width': 160,
                        'min-width': 60,
                    }
                },
                {
                    selector: 'node[?isRoot]',
                    style: {
                        'background-color': colors.rootBg,
                        'border-color': colors.rootBorder,
                        'border-width': 2.5,
                        'font-weight': 'bold',
                        'z-compound-depth': 'bottom',
                    }
                },
                {
                    selector: 'node[nodeType = "query"]',
                    style: {
                        'background-color': colors.queryBg,
                        'border-color': colors.queryBorder,
                        'border-width': 1.5,
                        'shape': 'diamond',
                        'width': 'label',
                        'height': 'label',
                        'padding': '12px',
                        'font-size': '10px',
                    }
                },
                {
                    selector: 'node[?isCyclic]',
                    style: {
                        'background-color': colors.cyclicBg,
                        'border-color': colors.cyclicBorder,
                        'border-width': 2,
                        'border-style': 'dashed',
                        'color': colors.cyclicText,
                    }
                },
                {
                    selector: 'edge[direction = "outbound"]',
                    style: {
                        'width': 1.5,
                        'line-color': colors.edgeOut,
                        'target-arrow-color': colors.edgeOut,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'arrow-scale': 0.9,
                    }
                },
                {
                    selector: 'edge[direction = "inbound"]',
                    style: {
                        'width': 1.5,
                        'line-color': colors.edgeIn,
                        'target-arrow-color': colors.edgeIn,
                        'target-arrow-shape': 'triangle',
                        'line-style': 'dashed',
                        'curve-style': 'bezier',
                        'arrow-scale': 0.9,
                    }
                },
                {
                    selector: 'node:active, node.hovered',
                    style: {
                        'overlay-color': colors.hoverFocus,
                        'overlay-opacity': 0.2,
                        'overlay-padding': 4,
                    }
                }
            ],
            layout: {
                name: (typeof cytoscapeDagre !== 'undefined') ? 'dagre' : 'breadthfirst',
                rankDir: 'LR',
                nodeSep: 40,
                rankSep: 120,
                padding: 40,
                animate: false,
                directed: true,
                roots: elements.filter(e => e.data && e.data.isRoot).map(e => '#' + e.data.id),
                spacingFactor: 1.4,
            },
            userZoomingEnabled: true,
            userPanningEnabled: true,
            minZoom: 0.1,
            maxZoom: 4,
            wheelSensitivity: 0.2,
        });

        // ── 노드 클릭 → 파일 이동 ──
        cy.on('tap', 'node', function(evt) {
            const node = evt.target;
            const data = node.data();
            if (data.uri) {
                vscode.postMessage({
                    type: 'openFile',
                    uri: data.uri,
                    line: data.line ?? 0,
                    character: data.character ?? 0,
                });
            }
        });

        // ── 툴팁 ──
        const tooltip = document.getElementById('tooltip');
        cy.on('mouseover', 'node', function(evt) {
            const data = evt.target.data();
            tooltip.textContent = data.fullLabel || data.label;
            tooltip.classList.add('visible');
        });
        cy.on('mousemove', function(evt) {
            if (tooltip.classList.contains('visible')) {
                tooltip.style.left = (evt.originalEvent.clientX + 12) + 'px';
                tooltip.style.top  = (evt.originalEvent.clientY + 12) + 'px';
            }
        });
        cy.on('mouseout', 'node', function() {
            tooltip.classList.remove('visible');
        });

        // ── 버튼 기능 ──
        document.getElementById('btnFit').addEventListener('click', () => cy.fit(undefined, 40));
        document.getElementById('btnZoomIn').addEventListener('click', () => cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }));
        document.getElementById('btnZoomOut').addEventListener('click', () => cy.zoom({ level: cy.zoom() * 0.77, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } }));
    </script>
</body>
</html>`;
    }

    // ─────────────────────────────────────────────
    // RefNode 트리 → Cytoscape Elements 변환
    // ─────────────────────────────────────────────

    private static _buildCytoscapeElements(root: RefNode): object[] {
        const nodes: object[] = [];
        const edges: object[] = [];
        const visited = new Set<string>();

        function makeShortLabel(label: string): string {
            // com.sample.service.FooService#doBar → FooService#doBar
            const parts = label.split('.');
            const last = parts[parts.length - 1];
            return last.length > 30 ? last.substring(0, 28) + '…' : last;
        }

        function traverse(node: RefNode): void {
            if (visited.has(node.id)) { return; }
            visited.add(node.id);

            nodes.push({
                data: {
                    id: node.id,
                    label: node.label,
                    shortLabel: makeShortLabel(node.label),
                    fullLabel: node.label,
                    nodeType: node.nodeType,
                    uri: node.uri,
                    line: node.line,
                    character: node.character,
                    isRoot: node.isRoot || false,
                    isCyclic: node.isCyclic || false,
                }
            });

            for (const child of node.outbound) {
                const edgeId = `e_out_${node.id}_${child.id}`;
                edges.push({
                    data: { id: edgeId, source: node.id, target: child.id, direction: 'outbound' }
                });
                traverse(child);
            }

            for (const parent of node.inbound) {
                // 인바운드: parent → root 방향
                const edgeId = `e_in_${parent.id}_${node.id}`;
                edges.push({
                    data: { id: edgeId, source: parent.id, target: node.id, direction: 'inbound' }
                });
                traverse(parent);
            }
        }

        traverse(root);
        return [...nodes, ...edges];
    }
}
