import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getNonce } from '../utils/nonce';
import { VelocityProcessor } from '../utils/VelocityProcessor';
import { QueryExecutionService, OracleConfig, SqliteConfig } from '../services/QueryExecutionService';

/**
 * Query Viewer 웹뷰 패널 (고도화)
 * 
 * 다단계 파이프라인:
 * 1. 원본 쿼리 표시 (<query> 태그 파싱)
 * 2. Velocity 변수 입력 + 분기/반복 처리
 * 3. CDATA 제거 (자동)
 * 4. iBatis 변수 입력 + 치환 (#{var}, :var)
 * 5. 쿼리 실행 (Oracle / SQLite)
 */
export class QueryViewerPanel {
    public static currentPanel: QueryViewerPanel | undefined;
    private static readonly viewType = 'queryViewer';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private readonly _executionService = new QueryExecutionService();
    private _currentFilePath: string = '';
    private _currentQueryId: string = '';

    /** 패널을 생성하거나 기존 패널을 재사용 */
    public static show(extensionUri: vscode.Uri, filePath: string, queryId: string): void {
        const column = vscode.ViewColumn.Beside;

        if (QueryViewerPanel.currentPanel) {
            QueryViewerPanel.currentPanel._panel.reveal(column);
            QueryViewerPanel.currentPanel._update(filePath, queryId);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            QueryViewerPanel.viewType,
            `Query: ${queryId}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        QueryViewerPanel.currentPanel = new QueryViewerPanel(panel, extensionUri, filePath, queryId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        filePath: string,
        queryId: string,
    ) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 메시지 핸들링
        this._panel.webview.onDidReceiveMessage(
            async (message: { command: string }) => {
                switch (message.command) {
                    case 'processVelocity':
                        this._handleVelocityProcess(message);
                        break;
                    case 'executeQuery':
                        await this._handleExecuteQuery(message);
                        break;
                    case 'openDdlFile':
                        this._handleOpenDdlFile(message);
                        break;
                    case 'executeDdlOnly':
                        await this._handleExecuteDdlOnly();
                        break;
                    case 'loadOracleConfig':
                        this._handleLoadOracleConfig();
                        break;
                }
            },
            null,
            this._disposables
        );

        this._update(filePath, queryId);
    }

    private _update(filePath: string, queryId: string): void {
        this._currentFilePath = filePath;
        this._currentQueryId = queryId;
        this._panel.title = `Query: ${queryId}`;
        const queryData = this._parseQuery(filePath, queryId);
        this._panel.webview.html = this._getHtml(this._panel.webview, queryData);
    }

    /**
     * Velocity 처리 요청 핸들러
     */
    private _handleVelocityProcess(message: any): void {
        try {
            const { rawSql, velocityVars } = message;
            const variables = new Map<string, string>(Object.entries(velocityVars || {}));
            const processed = VelocityProcessor.process(rawSql, variables);

            this._panel.webview.postMessage({
                command: 'velocityResult',
                processedSql: processed
            });
        } catch (e: any) {
            this._panel.webview.postMessage({
                command: 'velocityResult',
                error: `Velocity 처리 오류: ${e.message}`
            });
        }
    }

    /**
     * 프로젝트 루트 하위 jdbc.properties에서 jdbc.username, jdbc.password 읽기
     */
    private _loadJdbcCredentials(projectRoot: string): { user: string; password: string } | { error: string } {
        const jdbcPath = path.join(projectRoot, 'src', 'config', 'properties', 'jdbc.properties');
        if (!fs.existsSync(jdbcPath)) {
            return { error: 'Oracle 연결 실패: jdbc.properties를 찾을 수 없습니다.' };
        }
        let content: string;
        try {
            content = fs.readFileSync(jdbcPath, 'utf8');
        } catch {
            return { error: 'Oracle 연결 실패: jdbc.properties를 읽을 수 없습니다.' };
        }
        const props: Record<string, string> = {};
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 0) continue;
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            props[key] = value;
        }
        const user = props['jdbc.username'];
        const password = props['jdbc.password'];
        if (user === undefined || user === '') {
            return { error: 'Oracle 연결 실패: jdbc.username이 없습니다.' };
        }
        if (password === undefined) {
            return { error: 'Oracle 연결 실패: jdbc.password가 없습니다.' };
        }
        return { user, password: password || '' };
    }

    /**
     * 연결정보 불러오기 (jdbc.properties 검증)
     */
    private _handleLoadOracleConfig(): void {
        const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const cred = this._loadJdbcCredentials(projectRoot);
        if ('error' in cred) {
            this._panel.webview.postMessage({ command: 'loadOracleConfigResult', error: cred.error });
        } else {
            this._panel.webview.postMessage({ command: 'loadOracleConfigResult', message: '연결정보를 불러왔습니다.' });
        }
    }

    /**
     * 쿼리 실행 요청 핸들러
     */
    private async _handleExecuteQuery(message: any): Promise<void> {
        const { sql, bindParams, dbType } = message;
        let result;

        if (dbType === 'oracle') {
            const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const cred = this._loadJdbcCredentials(projectRoot);
            if ('error' in cred) {
                result = {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: 0,
                    error: cred.error,
                    type: 'select' as const
                };
            } else {
                const config: OracleConfig = {
                    user: cred.user,
                    password: cred.password,
                    connectString: '60.100.89.191:7971/SEVMQ',
                    instantClientPath: '',
                };
                result = await this._executionService.executeOnOracle(sql, bindParams || {}, config);
            }
        } else {
            const config: SqliteConfig = {
                queryFilePath: this._currentFilePath,
                queryId: this._currentQueryId,
            };
            result = await this._executionService.executeOnSqlite(sql, bindParams || {}, config);
        }

        this._panel.webview.postMessage({
            command: 'queryResult',
            result
        });
    }

    /**
     * DDL 파일 열기 핸들러
     */
    private _handleOpenDdlFile(message: any): void {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const relativeQueryPath = path.relative(workspaceRoot, this._currentFilePath);
        const queryFileDir = path.dirname(relativeQueryPath);
        const queryFileName = path.basename(relativeQueryPath, path.extname(relativeQueryPath));
        const ddlPath = path.join(workspaceRoot, '.vscode', queryFileDir, queryFileName, `${this._currentQueryId}.ddl.sql`);

        // DDL 파일이 없으면 생성
        const sqliteDir = path.dirname(ddlPath);
        if (!fs.existsSync(sqliteDir)) {
            fs.mkdirSync(sqliteDir, { recursive: true });
        }
        if (!fs.existsSync(ddlPath)) {
            fs.writeFileSync(ddlPath, `-- DDL for ${this._currentQueryId}\n-- 여기에 테이블 생성 DDL을 작성해 주세요.\n-- 예: CREATE TABLE tbl_user (empno TEXT, name TEXT);\n`);
        }

        vscode.window.showTextDocument(vscode.Uri.file(ddlPath));
    }

    /**
     * DDL만 수행 (쿼리 실행 없이 .ddl.sql 적용 후 .db 저장)
     */
    private async _handleExecuteDdlOnly(): Promise<void> {
        const config: SqliteConfig = {
            queryFilePath: this._currentFilePath,
            queryId: this._currentQueryId,
        };
        const result = await this._executionService.executeDdlOnlyOnSqlite(config);
        this._panel.webview.postMessage({ command: 'queryResult', result });
    }

    /** XML 파일에서 해당 queryId에 해당하는 SQL 블록을 파싱 */
    private _parseQuery(filePath: string, queryId: string): QueryData {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const nsMatch = content.match(/<mapper\s+[^>]*namespace\s*=\s*"([^"]+)"/);
            const namespace = nsMatch?.[1] || '';

            const escapedId = queryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // <query id="xxx"> 또는 <Query id="xxx"> 태그 매칭
            const tagPattern = new RegExp(
                `<[Qq]uery\\s+[^>]*\\bid\\s*=\\s*"${escapedId}"[^>]*>([\\s\\S]*?)<\\/[Qq]uery>`,
                'i'
            );
            const tagMatch = content.match(tagPattern);

            if (!tagMatch) {
            return {
                queryId, namespace, queryType: 'unknown',
                rawSql: `Query ID "${queryId}"를 찾을 수 없습니다.`,
                velocityVars: [], ibatisParams: [], bindParams: [], doubleBraceBlocks: []
            };
            }

            let rawBody = tagMatch[1].trim();

            // <statement> 태그 내부 추출 (있는 경우)
            const stmtMatch = rawBody.match(/<statement[^>]*>([\s\S]*?)<\/statement>/i);
            if (stmtMatch) {
                rawBody = stmtMatch[1].trim();
            }

            // SQL 본문의 첫 키워드로 queryType 판별
            const cdataStripped = VelocityProcessor.removeCDATA(rawBody);
            const velocityStripped = cdataStripped
                .replace(/#(?:if|elseif|elif|else|end|foreach|set|macro|parse|include)[^#\n]*/gi, '')
                .replace(/\$\{?\w+(?:\.\w+)*\}?/g, '')
                .trim();
            const firstWord = velocityStripped.match(/^\s*(\w+)/)?.[1]?.toUpperCase() || 'UNKNOWN';
            const queryType = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(firstWord) ? firstWord.toLowerCase() : 'query';

            // Velocity 변수 추출
            const velocityVars = VelocityProcessor.extractVariables(rawBody);

            // iBatis 파라미터 추출 (#{var} 형태)
            const ibatisParamSet = new Set<string>();
            const ibatisRegex = /#\{([^},]+?)(?:\s*,[^}]*)?\}/g;
            let pm: RegExpExecArray | null;
            while ((pm = ibatisRegex.exec(rawBody)) !== null) {
                ibatisParamSet.add(pm[1].trim());
            }

            // 바인드 변수 추출 (:var 또는 :session.xxx 형태, SQL 키워드 제외)
            const bindParamSet = new Set<string>();
            const bindRegex = /:([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g;
            const sqlKeywords = new Set(['select', 'from', 'where', 'and', 'or', 'not', 'in', 'null', 'is', 'as', 'on', 'set', 'into', 'values', 'join', 'left', 'right', 'inner', 'outer', 'order', 'by', 'group', 'having', 'like', 'between', 'exists', 'case', 'when', 'then', 'else', 'end', 'distinct', 'union', 'all', 'limit', 'offset', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'table', 'index']);
            let bm: RegExpExecArray | null;
            while ((bm = bindRegex.exec(rawBody)) !== null) {
                const varName = bm[1];
                const firstToken = varName.includes('.') ? varName.split('.')[0] : varName;
                if (!sqlKeywords.has(firstToken.toLowerCase())) {
                    bindParamSet.add(varName);
                }
            }

            // {{구문}} 블록 추출 (여러 줄·긴 내용 가능)
            const doubleBraceBlocks: { key: string; literal: string }[] = [];
            const doubleBraceRegex = /\{\{([\s\S]*?)\}\}/g;
            let dm: RegExpExecArray | null;
            let idx = 0;
            while ((dm = doubleBraceRegex.exec(rawBody)) !== null) {
                doubleBraceBlocks.push({ key: `doubleBrace_${idx}`, literal: dm[0] });
                idx++;
            }

            return {
                queryId, namespace, queryType, rawSql: rawBody,
                velocityVars,
                ibatisParams: Array.from(ibatisParamSet),
                bindParams: Array.from(bindParamSet),
                doubleBraceBlocks
            };
        } catch (e) {
            return {
                queryId, namespace: '', queryType: 'error',
                rawSql: `파일을 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`,
                velocityVars: [], ibatisParams: [], bindParams: [], doubleBraceBlocks: [],
            };
        }
    }

    /** Webview HTML 생성 */
    private _getHtml(webview: vscode.Webview, data: QueryData): string {
        const nonce = getNonce();
        const dataJson = JSON.stringify({
            queryId: data.queryId,
            namespace: data.namespace,
            queryType: data.queryType,
            rawSql: data.rawSql,
            velocityVars: data.velocityVars,
            ibatisParams: data.ibatisParams,
            bindParams: data.bindParams,
            doubleBraceBlocks: data.doubleBraceBlocks,
        });

        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Viewer: ${this._escapeHtml(data.queryId)}</title>
    <style>${this._getCss()}</style>
</head>
<body>
    <div class="header">
        <h2>
            <span class="badge badge-${data.queryType}">${data.queryType.toUpperCase()}</span>
            ${this._escapeHtml(data.queryId)}
        </h2>
        ${data.namespace ? `<div class="info-row"><b>Namespace:</b> ${this._escapeHtml(data.namespace)}</div>` : ''}
    </div>

    <!-- 파이프라인 진행도 -->
    <div class="pipeline">
        <div class="pipe-step active" data-step="1">
            <div class="pipe-num">1</div>
            <div class="pipe-label">원본 쿼리</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step" data-step="2">
            <div class="pipe-num">2</div>
            <div class="pipe-label">Velocity 처리</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step" data-step="3">
            <div class="pipe-num">3</div>
            <div class="pipe-label">변수 치환</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step" data-step="4">
            <div class="pipe-num">4</div>
            <div class="pipe-label">쿼리 실행</div>
        </div>
    </div>

    <!-- Step 1: 원본 쿼리 -->
    <div class="section" id="step1">
        <div class="section-title">① 원본 쿼리 (Raw)</div>
        <pre id="rawSql"></pre>
    </div>

    <!-- Step 2: Velocity 처리 -->
    <div class="section" id="step2">
        <div class="section-title">② Velocity 변수 입력</div>
        <div id="velocityVarArea"></div>
        <div class="btn-row">
            <button class="action-btn" id="processVelocityBtn">▶ Velocity 처리 실행</button>
        </div>
        <div class="section-subtitle">Velocity 처리 결과</div>
        <pre id="velocityResult"><span class="placeholder">Velocity 처리 버튼을 눌러주세요.</span></pre>
    </div>

    <!-- Step 3: 변수 -->
    <div class="section" id="step3">
        <div class="section-title">③ 변수</div>
        <div id="ibatisParamArea"></div>
        <div class="btn-row">
            <button class="action-btn" id="transformBtn">▶ 변수 치환 실행</button>
        </div>
        <div class="section-subtitle">최종 쿼리</div>
        <div class="finalSql-wrap">
            <button class="copy-icon-btn" id="copyBtn" type="button" title="복사">📋</button>
            <pre id="finalSql"><span class="placeholder">변수 치환 버튼을 눌러주세요.</span></pre>
        </div>
    </div>

    <!-- Step 4: 쿼리 실행 -->
    <div class="section" id="step4">
        <div class="section-title">④ 쿼리 실행</div>
        <div class="db-selector">
            <label class="radio-label">
                <input type="radio" name="dbType" value="oracle" checked> Oracle DB
            </label>
            <label class="radio-label">
                <input type="radio" name="dbType" value="sqlite"> SQLite
            </label>
        </div>
        <div id="oracleConfig" class="config-panel">
            <div class="btn-row">
                <button class="action-btn secondary" id="loadOracleConfigBtn">연결정보 불러오기</button>
            </div>
            <div id="oracleConfigStatus" class="oracle-config-status"></div>
        </div>
        <div id="sqliteConfig" class="config-panel" style="display:none">
            <div class="sqlite-info">
                <span class="info-icon">ℹ️</span>
                SQLite: DDL 파일 열기/생성 → DDL 수행 → 쿼리 실행
            </div>
            <div class="btn-row">
                <button class="action-btn secondary" id="openDdlBtn">📄 DDL 파일 열기/생성</button>
                <button class="action-btn secondary" id="runDdlBtn">▶ DDL 수행</button>
            </div>
        </div>
        <div class="btn-row">
            <button class="action-btn execute" id="executeBtn">⚡ 쿼리 실행</button>
        </div>
        <div id="resultArea" style="display:none">
            <div class="result-header">
                <span id="resultInfo"></span>
            </div>
            <div class="table-wrap">
                <table id="resultTable">
                    <thead id="resultHead"></thead>
                    <tbody id="resultBody"></tbody>
                </table>
            </div>
            <div id="resultError" class="error-msg" style="display:none"></div>
        </div>
    </div>

    <script nonce="${nonce}">
    (function() {
        var vscode = acquireVsCodeApi();
        var data = ${dataJson};
        var rawSql = data.rawSql;
        var velocityProcessedSql = '';
        var finalSql = '';

        // ─── 유틸리티 ───
        function escapeHtml(s) {
            return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function highlightSql(sql) {
            var e = escapeHtml(sql);
            e = e.replace(/(--[^\\n]*)/g, '<span class="cmt">$1</span>');
            e = e.replace(/(#\\{[^}]+\\})/g, '<span class="ph">$1</span>');
            e = e.replace(/(\\$\\{[^}]+\\})/g, '<span class="ph">$1</span>');
            e = e.replace(/(\\{\\{[\\s\\S]*?\\}\\})/g, '<span class="ph">$1</span>');
            e = e.replace(/(:[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)/g, '<span class="bind">$1</span>');
            // Velocity 지시자 하이라이트
            e = e.replace(/(#(?:if|elseif|elif|else|end|foreach|set|macro|parse|include)\\b[^\\n]*)/gi, '<span class="vel">$1</span>');
            // CDATA 하이라이트
            e = e.replace(/(&lt;!\\[CDATA\\[)/g, '<span class="cdata">$1</span>');
            e = e.replace(/(\\]\\]&gt;)/g, '<span class="cdata">$1</span>');
            var kwList = "SELECT|FROM|WHERE|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|ORDER BY|GROUP BY|HAVING|INSERT INTO|VALUES|UPDATE|SET|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|IS|NULL|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|LIMIT|OFFSET|COUNT|SUM|AVG|MAX|MIN|CONCAT|CREATE|TABLE|DROP|ALTER|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT";
            e = e.replace(new RegExp("(<span[^>]*>.*?</span>)|\\\\b(" + kwList + ")\\\\b", "gi"), function(m, tag, kw) {
                if (tag) return tag;
                return '<span class="kw">' + kw.toUpperCase() + "</span>";
            });
            return e;
        }

        // ─── Step 1: 원본 쿼리 표시 ───
        document.getElementById('rawSql').innerHTML = highlightSql(rawSql);

        // ─── Step 2: Velocity 변수 입력 폼 ───
        var velArea = document.getElementById('velocityVarArea');
        if (data.velocityVars.length === 0) {
            velArea.innerHTML = '<div class="no-params">Velocity 변수가 없습니다.</div>';
        } else {
            var grid = document.createElement('div');
            grid.className = 'param-grid';
            data.velocityVars.forEach(function(v) {
                var label = document.createElement('div');
                label.className = 'param-label';
                label.textContent = '$' + v;
                var inp = document.createElement('input');
                inp.className = 'param-input';
                inp.type = 'text';
                inp.dataset.velVar = v;
                inp.placeholder = '값 입력...';
                grid.appendChild(label);
                grid.appendChild(inp);
            });
            velArea.appendChild(grid);
        }

        document.getElementById('processVelocityBtn').addEventListener('click', function() {
            var vars = {};
            velArea.querySelectorAll('.param-input').forEach(function(inp) {
                if (inp.value.trim()) {
                    vars[inp.dataset.velVar] = inp.value.trim();
                }
            });
            vscode.postMessage({ command: 'processVelocity', rawSql: rawSql, velocityVars: vars });
            document.getElementById('velocityResult').innerHTML = '<span class="placeholder">처리 중...</span>';
            updatePipeline(2);
        });

        // ─── Velocity 결과 수신 ───
        window.addEventListener('message', function(event) {
            var msg = event.data;
            if (msg.command === 'velocityResult') {
                if (msg.error) {
                    document.getElementById('velocityResult').innerHTML = '<span class="error-text">' + escapeHtml(msg.error) + '</span>';
                } else {
                    velocityProcessedSql = msg.processedSql;
                    document.getElementById('velocityResult').innerHTML = highlightSql(velocityProcessedSql);
                    var velocityValues = {};
                    velArea.querySelectorAll('.param-input').forEach(function(inp) {
                        if (inp.dataset.velVar && inp.value.trim()) velocityValues[inp.dataset.velVar] = inp.value.trim();
                    });
                    refreshIbatisParams(velocityProcessedSql, velocityValues);
                }
            } else if (msg.command === 'queryResult') {
                showQueryResult(msg.result);
            } else if (msg.command === 'loadOracleConfigResult') {
                var el = document.getElementById('oracleConfigStatus');
                if (msg.error) el.textContent = msg.error; else el.textContent = msg.message || '연결정보를 불러왔습니다.';
            }
        });

        // ─── Step 3: 변수 ───
        var ibatisArea = document.getElementById('ibatisParamArea');
        var doubleBraceLiterals = [];

        function refreshIbatisParams(sql, velocityValues) {
            var allParams = [];
            var seen = new Set();
            // #{var} 추출
            var hashRegex = /#\\{([^},]+?)(?:\\s*,[^}]*)?\\}/g;
            var m;
            while ((m = hashRegex.exec(sql)) !== null) {
                var name = m[1].trim();
                if (!seen.has('hash:' + name)) { seen.add('hash:' + name); allParams.push({name: name, type: 'hash'}); }
            }
            // :var 또는 :session.xxx 추출 (점 포함 하나의 변수로)
            var bindRegex = /:([a-zA-Z_]\\w*(?:\\.[a-zA-Z_]\\w*)*)/g;
            var sqlKws = new Set(['select','from','where','and','or','not','in','null','is','as','on','set','into','values','join','left','right','inner','outer','order','by','group','having','like','between','exists','case','when','then','else','end','distinct','union','all','limit','offset','insert','update','delete','create','drop','alter','table','index']);
            while ((m = bindRegex.exec(sql)) !== null) {
                var firstTok = m[1].indexOf('.') >= 0 ? m[1].split('.')[0] : m[1];
                if (!sqlKws.has(firstTok.toLowerCase()) && !seen.has('bind:' + m[1])) {
                    seen.add('bind:' + m[1]);
                    allParams.push({name: m[1], type: 'bind'});
                }
            }
            // {{구문}} 추출
            doubleBraceLiterals = [];
            var dbRegex = /\\{\\{([\\s\\S]*?)\\}\\}/g;
            var dbIdx = 0;
            while ((m = dbRegex.exec(sql)) !== null) {
                doubleBraceLiterals.push(m[0]);
                allParams.push({name: 'doubleBrace_' + dbIdx, type: 'doubleBrace', literal: m[0], dbIndex: dbIdx});
                dbIdx++;
            }

            ibatisArea.innerHTML = '';
            if (allParams.length === 0) {
                ibatisArea.innerHTML = '<div class="no-params">파라미터가 없습니다.</div>';
            } else {
                var grid = document.createElement('div');
                grid.className = 'param-grid';
                allParams.forEach(function(p) {
                    var label = document.createElement('div');
                    label.className = 'param-label';
                    if (p.type === 'doubleBrace') {
                        var preview = p.literal.length > 50 ? p.literal.substring(0, 50).replace(/\\n/g, ' ') + '…' : p.literal.replace(/\\n/g, ' ');
                        label.textContent = '{{ 구문 }} (' + preview + ')';
                    } else {
                        label.textContent = (p.type === 'hash' ? '#{' + p.name + '}' : ':' + p.name);
                    }
                    var inp;
                    if (p.type === 'doubleBrace') {
                        inp = document.createElement('textarea');
                        inp.rows = 3;
                        inp.className = 'param-input param-textarea';
                    } else {
                        inp = document.createElement('input');
                        inp.type = 'text';
                        inp.className = 'param-input';
                    }
                    inp.placeholder = '값 입력...';
                    inp.dataset.param = p.name;
                    inp.dataset.paramType = p.type;
                    if (p.type === 'doubleBrace') inp.dataset.dbIndex = String(p.dbIndex);
                    if (velocityValues && velocityValues[p.name] !== undefined) {
                        inp.value = velocityValues[p.name];
                        inp.disabled = true;
                    }
                    grid.appendChild(label);
                    grid.appendChild(inp);
                });
                ibatisArea.appendChild(grid);
            }
        }
        // 초기 변수 로드
        refreshIbatisParams(rawSql);

        function escapeRegex(s) {
            var specials = '.\\\\*+?^$' + '{}()|[]';
            var out = '';
            for (var i = 0; i < s.length; i++) {
                if (specials.indexOf(s[i]) !== -1) out += '\\\\' + s[i];
                else out += s[i];
            }
            return out;
        }

        document.getElementById('transformBtn').addEventListener('click', function() {
            var sql = velocityProcessedSql || rawSql;
            // CDATA 제거
            sql = sql.replace(/<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1');

            var inputs = ibatisArea.querySelectorAll('.param-input');
            inputs.forEach(function(inp) {
                var p = inp.dataset.param;
                var t = inp.dataset.paramType;
                var v = inp.value.trim();
                if (t === 'hash') {
                    if (v) {
                        var hr = new RegExp('#\\\\{' + escapeRegex(p) + '(?:\\\\s*,[^}]*)?\\\\}', 'g');
                        if (/^-?\\d+(\\.\\d+)?$/.test(v)) {
                            sql = sql.replace(hr, v);
                        } else {
                            sql = sql.replace(hr, "'" + v.replace(/'/g, "''") + "'");
                        }
                    }
                } else if (t === 'bind') {
                    var br = new RegExp(':' + escapeRegex(p) + '\\\\b', 'g');
                    if (v) {
                        if (/^-?\\d+(\\.\\d+)?$/.test(v)) {
                            sql = sql.replace(br, v);
                        } else {
                            sql = sql.replace(br, "'" + v.replace(/'/g, "''") + "'");
                        }
                    }
                } else if (t === 'doubleBrace') {
                    var idx = parseInt(inp.dataset.dbIndex, 10);
                    if (!isNaN(idx) && doubleBraceLiterals[idx] !== undefined) {
                        var lit = doubleBraceLiterals[idx];
                        sql = sql.split(lit).join(v);
                    }
                }
            });

            finalSql = sql;
            document.getElementById('finalSql').innerHTML = highlightSql(sql);
            updatePipeline(3);
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = finalSql || '';
            navigator.clipboard.writeText(text).then(function() {
                var btn = document.getElementById('copyBtn');
                btn.textContent = '✓';
                setTimeout(function() { btn.textContent = '📋'; }, 1500);
            });
        });

        // ─── Step 4: 쿼리 실행 ───
        var dbTypeRadios = document.querySelectorAll('input[name="dbType"]');
        dbTypeRadios.forEach(function(r) {
            r.addEventListener('change', function() {
                document.getElementById('oracleConfig').style.display = r.value === 'oracle' ? '' : 'none';
                document.getElementById('sqliteConfig').style.display = r.value === 'sqlite' ? '' : 'none';
            });
        });

        document.getElementById('loadOracleConfigBtn').addEventListener('click', function() {
            document.getElementById('oracleConfigStatus').textContent = '불러오는 중...';
            vscode.postMessage({ command: 'loadOracleConfig' });
        });

        document.getElementById('openDdlBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'openDdlFile' });
        });
        document.getElementById('runDdlBtn').addEventListener('click', function() {
            document.getElementById('resultArea').style.display = '';
            document.getElementById('resultInfo').textContent = 'DDL 수행 중...';
            document.getElementById('resultError').style.display = 'none';
            document.getElementById('resultHead').innerHTML = '';
            document.getElementById('resultBody').innerHTML = '';
            vscode.postMessage({ command: 'executeDdlOnly' });
        });

        document.getElementById('executeBtn').addEventListener('click', function() {
            var dbType = document.querySelector('input[name="dbType"]:checked').value;

            // 최종 SQL: 변수 치환된 finalSql이 있으면 사용, 없으면 지금 입력값으로 한 번 치환한 뒤 사용 (바인딩 없이 치환된 SQL만 전송)
            var sql = finalSql;
            if (!sql) {
                sql = velocityProcessedSql || rawSql;
                sql = sql.replace(/<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1');
                var inputs = ibatisArea.querySelectorAll('.param-input');
                inputs.forEach(function(inp) {
                    var p = inp.dataset.param;
                    var t = inp.dataset.paramType;
                    var v = inp.value.trim();
                    if (t === 'hash' && v) {
                        var hr = new RegExp('#\\\\{' + escapeRegex(p) + '(?:\\\\s*,[^}]*)?\\\\}', 'g');
                        sql = /^-?\\d+(\\.\\d+)?$/.test(v) ? sql.replace(hr, v) : sql.replace(hr, "'" + v.replace(/'/g, "''") + "'");
                    } else if (t === 'bind' && v) {
                        var br = new RegExp(':' + escapeRegex(p) + '\\\\b', 'g');
                        sql = /^-?\\d+(\\.\\d+)?$/.test(v) ? sql.replace(br, v) : sql.replace(br, "'" + v.replace(/'/g, "''") + "'");
                    } else if (t === 'doubleBrace') {
                        var idx = parseInt(inp.dataset.dbIndex, 10);
                        if (!isNaN(idx) && doubleBraceLiterals[idx] !== undefined) {
                            sql = sql.split(doubleBraceLiterals[idx]).join(v);
                        }
                    }
                });
            }
            sql = sql.replace(/<\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1');

            // 치환된 최종 SQL만 전송 (바인딩 없음). 단, 변수 치환 없이 실행한 경우만 예외로 바인드 파라미터 전달
            var bindParams = {};
            if (!finalSql) {
                ibatisArea.querySelectorAll('.param-input').forEach(function(inp) {
                    if (inp.dataset.paramType === 'bind') bindParams[inp.dataset.param] = inp.value.trim();
                });
            }

            document.getElementById('resultArea').style.display = '';
            document.getElementById('resultInfo').textContent = '실행 중...';
            document.getElementById('resultError').style.display = 'none';
            document.getElementById('resultHead').innerHTML = '';
            document.getElementById('resultBody').innerHTML = '';

            vscode.postMessage({
                command: 'executeQuery',
                sql: sql,
                bindParams: bindParams,
                dbType: dbType
            });

            updatePipeline(4);
        });

        function showQueryResult(result) {
            document.getElementById('resultArea').style.display = '';

            if (result.error) {
                document.getElementById('resultError').style.display = '';
                document.getElementById('resultError').textContent = result.error;
                document.getElementById('resultInfo').textContent = '실행 실패 (' + result.executionTime + 'ms)';
                return;
            }

            document.getElementById('resultError').style.display = 'none';
            document.getElementById('resultInfo').textContent =
                result.rowCount + '행 반환 (' + result.executionTime + 'ms)';

            // 테이블 헤더
            var thead = document.getElementById('resultHead');
            var headRow = '<tr>';
            result.columns.forEach(function(col) {
                headRow += '<th>' + escapeHtml(String(col)) + '</th>';
            });
            headRow += '</tr>';
            thead.innerHTML = headRow;

            // 테이블 바디
            var tbody = document.getElementById('resultBody');
            var bodyHtml = '';
            result.rows.forEach(function(row) {
                bodyHtml += '<tr>';
                row.forEach(function(cell) {
                    var val = cell === null ? '<span class="null-val">NULL</span>' : escapeHtml(String(cell));
                    bodyHtml += '<td>' + val + '</td>';
                });
                bodyHtml += '</tr>';
            });
            tbody.innerHTML = bodyHtml;
        }

        // ─── 파이프라인 UI 업데이트 ───
        function updatePipeline(activeStep) {
            document.querySelectorAll('.pipe-step').forEach(function(el) {
                var step = parseInt(el.dataset.step);
                el.classList.toggle('active', step <= activeStep);
                el.classList.toggle('current', step === activeStep);
            });
        }

    })();
    </script>
</body>
</html>`;
    }

    private _getCss(): string {
        return `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 16px 24px;
            line-height: 1.5;
        }
        .header { margin-bottom: 16px; }
        h2 {
            font-size: 15px; font-weight: 600;
            color: var(--vscode-foreground);
            display: flex; align-items: center; gap: 8px;
        }
        .badge {
            display: inline-block; padding: 2px 10px; border-radius: 10px;
            font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .badge-select { background: #2b7489; color: #fff; }
        .badge-insert { background: #6f42c1; color: #fff; }
        .badge-update { background: #e36209; color: #fff; }
        .badge-delete { background: #cb2431; color: #fff; }
        .badge-query { background: #0366d6; color: #fff; }
        .badge-unknown, .badge-error { background: #586069; color: #fff; }
        .info-row { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .info-row b { color: var(--vscode-foreground); }

        /* 파이프라인 */
        .pipeline {
            display: flex; align-items: center; gap: 4px;
            margin-bottom: 20px; padding: 10px 12px;
            background: var(--vscode-textCodeBlock-background, #1e1e1e);
            border-radius: 6px; border: 1px solid var(--vscode-widget-border, #333);
        }
        .pipe-step {
            display: flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 4px;
            font-size: 12px; opacity: 0.4;
            transition: all 0.2s;
        }
        .pipe-step.active { opacity: 1; }
        .pipe-step.current { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 600; }
        .pipe-num {
            width: 20px; height: 20px; border-radius: 50%;
            background: var(--vscode-descriptionForeground); color: var(--vscode-editor-background);
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; font-weight: 700;
        }
        .pipe-step.current .pipe-num { background: var(--vscode-badge-foreground); color: var(--vscode-badge-background); }
        .pipe-label { font-size: 12px; }
        .pipe-arrow { color: var(--vscode-descriptionForeground); font-size: 14px; margin: 0 2px; }

        /* 섹션 */
        .section { margin-bottom: 20px; }
        .section-title {
            font-size: 13px; font-weight: 600;
            color: var(--vscode-foreground); margin-bottom: 8px;
            padding-bottom: 4px; border-bottom: 1px solid var(--vscode-widget-border, #333);
        }
        .section-subtitle {
            font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground);
            margin: 10px 0 6px 0;
        }

        /* 코드 블록 */
        pre {
            background: var(--vscode-textCodeBlock-background, #1e1e1e);
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 4px; padding: 12px 16px; overflow-x: auto;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            white-space: pre-wrap; word-break: break-all; line-height: 1.6;
            max-height: 300px; overflow-y: auto;
        }
        .finalSql-wrap {
            position: relative;
        }
        .finalSql-wrap pre { padding-top: 36px; }
        .copy-icon-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 28px;
            height: 28px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            z-index: 1;
        }
        .copy-icon-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }

        /* 파라미터 입력 */
        .param-grid {
            display: grid; grid-template-columns: 160px 1fr;
            gap: 6px 12px; align-items: center;
        }
        .param-label {
            font-size: 12px; font-weight: 600;
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); text-align: right;
        }
        .param-input {
            width: 100%; padding: 4px 8px;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px; outline: none;
        }
        .param-input:focus { border-color: var(--vscode-focusBorder); }
        .param-textarea { min-height: 60px; resize: vertical; }
        .no-params { font-size: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
        .oracle-config-status { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; }

        /* 구문 하이라이트 */
        .kw { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); font-weight: bold; }
        .ph { color: #dcdcaa; background: rgba(220,220,170,0.1); border-radius: 2px; padding: 0 2px; }
        .bind { color: #ce9178; font-weight: 600; }
        .vel { color: #c586c0; font-style: italic; }
        .cdata { color: #608b4e; font-weight: 600; }
        .cmt { color: var(--vscode-symbolIcon-commentForeground, #6a9955); font-style: italic; }
        .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
        .error-text { color: var(--vscode-errorForeground, #f48771); }

        /* 버튼 */
        .btn-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
        .action-btn {
            padding: 6px 16px;
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
            transition: background 0.15s;
        }
        .action-btn:hover { background: var(--vscode-button-hoverBackground); }
        .action-btn.secondary {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
        }
        .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
        .action-btn.execute {
            background: #28a745; color: #fff;
        }
        .action-btn.execute:hover { background: #22863a; }
        .copy-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #fff);
            border: none; border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        .copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }

        /* DB 선택 */
        .db-selector { display: flex; gap: 16px; margin-bottom: 10px; }
        .radio-label {
            display: flex; align-items: center; gap: 4px;
            font-size: 13px; cursor: pointer;
        }
        .config-panel { margin-bottom: 10px; }
        .config-grid {
            display: grid; grid-template-columns: 100px 1fr;
            gap: 6px 10px; align-items: center; font-size: 12px;
        }
        .config-input {
            width: 100%; padding: 4px 8px;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 3px; font-size: 12px; outline: none;
        }
        .config-input:focus { border-color: var(--vscode-focusBorder); }
        .sqlite-info {
            font-size: 12px; padding: 8px 12px;
            background: var(--vscode-textCodeBlock-background); border-radius: 4px;
            margin-bottom: 8px;
        }
        .info-icon { font-size: 14px; }

        /* 결과 테이블 */
        .result-header {
            font-size: 12px; color: var(--vscode-descriptionForeground);
            margin: 10px 0 6px 0; font-weight: 600;
        }
        .table-wrap { overflow-x: auto; max-height: 400px; overflow-y: auto; }
        table {
            width: 100%; border-collapse: collapse; font-size: 12px;
            font-family: var(--vscode-editor-font-family, monospace);
        }
        th {
            background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
            color: var(--vscode-foreground); padding: 6px 10px;
            text-align: left; border: 1px solid var(--vscode-widget-border, #333);
            font-weight: 600; position: sticky; top: 0;
        }
        td {
            padding: 4px 10px; border: 1px solid var(--vscode-widget-border, #333);
            color: var(--vscode-foreground);
        }
        tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
        tr:hover td { background: rgba(255,255,255,0.05); }
        .null-val { color: var(--vscode-descriptionForeground); font-style: italic; }
        .error-msg {
            font-size: 12px; color: var(--vscode-errorForeground, #f48771);
            padding: 8px 12px; background: rgba(244,135,113,0.1);
            border-radius: 4px; margin-top: 8px; white-space: pre-wrap;
        }
        `;
    }

    private _escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    public dispose(): void {
        QueryViewerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }
}

interface QueryData {
    queryId: string;
    namespace: string;
    queryType: string;
    rawSql: string;
    velocityVars: string[];
    ibatisParams: string[];
    bindParams: string[];
    doubleBraceBlocks: { key: string; literal: string }[];
}
