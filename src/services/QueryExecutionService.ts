import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 쿼리 실행 결과 인터페이스
 */
export interface QueryResult {
    columns: string[];
    rows: any[][];
    rowCount: number;
    executionTime: number; // ms
    error?: string;
    type: 'select' | 'dml'; // SELECT vs INSERT/UPDATE/DELETE
}

/**
 * Oracle DB 접속 설정
 */
export interface OracleConfig {
    user: string;
    password: string;
    connectString: string;      // thin 모드: host:port/service
    instantClientPath?: string; // thick 모드 (Runtime Instant Client 경로)
}

/**
 * SQLite 설정
 */
export interface SqliteConfig {
    queryFilePath: string;  // 원본 쿼리 파일 절대경로
    queryId: string;        // 쿼리 ID
}

/**
 * 쿼리 실행 서비스
 * Oracle DB (thin / thick) 및 SQLite 실행 지원
 */
export class QueryExecutionService {

    /**
     * DDL 문자열에서 주석 제거 (실행 시 주석 없는 것처럼 처리)
     * - -- : 해당 문자부터 줄 끝까지 주석
     * - 블록 주석: 슬래시별 ... 별슬래시 (여러 줄 가능)
     */
    private static _stripDdlComments(ddl: string): string {
        // 1. 블록 주석 제거 (slash-star ~ star-slash, 여러 줄 가능)
        const blockCommentRegex = new RegExp('\\/\\*[\\s\\S]*?\\*\\/', 'g');
        let result = ddl.replace(blockCommentRegex, ' ');
        // 2. -- 라인 주석: 라인 전체가 -- 로 시작하면 제거, 아니면 줄 끝의 \s-- 부터 제거
        result = result
            .split('\n')
            .map((line: string) => {
                const t = line.trim();
                if (t.startsWith('--')) return '';
                return line.replace(/\s--[^\n]*$/, '').trimEnd();
            })
            .join('\n')
            .trim();
        return result;
    }

    /**
     * DDL 파일 내용을 문장 단위로 파싱 (주석 제거 후 세미콜론으로 분리)
     */
    private static _parseDdlStatements(ddlPath: string): string[] {
        const ddlContent = fs.readFileSync(ddlPath, 'utf8').trim();
        if (!ddlContent) return [];
        const stripped = this._stripDdlComments(ddlContent);
        if (!stripped) return [];
        return stripped
            .split(';')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);
    }

    /**
     * Oracle DB에서 쿼리 실행 (Thin 모드)
     */
    async executeOnOracle(sql: string, bindParams: Record<string, any>, config: OracleConfig): Promise<QueryResult> {
        const startTime = Date.now();
        try {
            // oracledb 동적 import (설치되어 있지 않을 수 있음)
            let oracledb: any;
            try {
                oracledb = require('oracledb');
            } catch {
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: 'oracledb 패키지가 설치되어 있지 않습니다. `npm install oracledb`를 실행해 주세요.',
                    type: 'select'
                };
            }

            // Thick 모드 초기화 (instantClientPath가 설정된 경우)
            if (config.instantClientPath) {
                try {
                    oracledb.initOracleClient({ libDir: config.instantClientPath });
                } catch (e: any) {
                    // 이미 초기화된 경우 무시
                    if (!e.message?.includes('already initialized')) {
                        return {
                            columns: [], rows: [], rowCount: 0,
                            executionTime: Date.now() - startTime,
                            error: `Oracle Instant Client 초기화 실패: ${e.message}`,
                            type: 'select'
                        };
                    }
                }
            }

            const connection = await oracledb.getConnection({
                user: config.user,
                password: config.password,
                connectString: config.connectString
            });

            try {
                const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

                if (isSelect) {
                    const result = await connection.execute(sql, bindParams, {
                        outFormat: oracledb.OUT_FORMAT_ARRAY,
                        maxRows: 1000
                    });

                    const columns = result.metaData?.map((m: any) => m.name) || [];
                    const rows = result.rows || [];

                    return {
                        columns,
                        rows,
                        rowCount: rows.length,
                        executionTime: Date.now() - startTime,
                        type: 'select'
                    };
                } else {
                    const result = await connection.execute(sql, bindParams, { autoCommit: true });
                    return {
                        columns: ['Affected Rows'],
                        rows: [[result.rowsAffected || 0]],
                        rowCount: 1,
                        executionTime: Date.now() - startTime,
                        type: 'dml'
                    };
                }
            } finally {
                await connection.close();
            }
        } catch (e: any) {
            return {
                columns: [], rows: [], rowCount: 0,
                executionTime: Date.now() - startTime,
                error: `Oracle 실행 오류: ${e.message}`,
                type: 'select'
            };
        }
    }

    /**
     * SQLite에서 쿼리 실행 (sql.js WASM 사용)
     * .vscode/{쿼리파일 상대경로+파일명}/{queryId}.db 에 DB 파일 생성
     * .vscode/{쿼리파일 상대경로+파일명}/{queryId}.ddl.sql 에 DDL 파일 생성
     */
    async executeOnSqlite(sql: string, bindParams: Record<string, any>, config: SqliteConfig): Promise<QueryResult> {
        const startTime = Date.now();
        try {
            let initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<any>;
            try {
                const sqljs = await import('sql.js');
                initSqlJs = sqljs.default;
            } catch {
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: 'sql.js 패키지가 설치되어 있지 않습니다. `npm install sql.js`를 실행해 주세요.',
                    type: 'select'
                };
            }

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: '워크스페이스가 열려있지 않습니다.',
                    type: 'select'
                };
            }

            // 쿼리 파일의 상대 경로 + 파일명으로 폴더명 생성
            const relativeQueryPath = path.relative(workspaceRoot, config.queryFilePath);
            const queryFileDir = path.dirname(relativeQueryPath);
            const queryFileName = path.basename(relativeQueryPath, path.extname(relativeQueryPath));
            const sqliteDir = path.join(workspaceRoot, '.vscode', queryFileDir, queryFileName);

            // 디렉토리 생성
            if (!fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, { recursive: true });
            }

            const dbPath = path.join(sqliteDir, `${config.queryId}.db`);
            const SQL = await initSqlJs();
            // 0바이트 DB 파일은 없음으로 간주 (sql.js가 빈 버퍼로 로드 시 export가 비어 나올 수 있음)
            let dbBuffer: Buffer | undefined;
            if (fs.existsSync(dbPath)) {
                const buf = fs.readFileSync(dbPath);
                if (buf.length > 0) dbBuffer = buf;
            }
            const db = new SQL.Database(dbBuffer);

            try {
                // sql.js는 named parameter에 접두사 포함 키 사용 (:name, @name, $name)
                const sqliteBinds: Record<string, any> = {};
                for (const [key, value] of Object.entries(bindParams)) {
                    if (!key.startsWith(':') && !key.startsWith('@') && !key.startsWith('$')) {
                        sqliteBinds[':' + key] = value;
                    } else {
                        sqliteBinds[key] = value;
                    }
                }

                const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

                if (isSelect) {
                    const result = db.exec(sql, sqliteBinds);
                    if (!result || result.length === 0) {
                        return {
                            columns: [], rows: [], rowCount: 0,
                            executionTime: Date.now() - startTime,
                            type: 'select'
                        };
                    }
                    const first = result[0];
                    const columns = first.columns || [];
                    const rows = first.values || [];

                    return {
                        columns,
                        rows,
                        rowCount: rows.length,
                        executionTime: Date.now() - startTime,
                        type: 'select'
                    };
                } else {
                    db.run(sql, sqliteBinds);
                    const changeResult = db.exec('SELECT changes()');
                    const changes = changeResult?.[0]?.values?.[0]?.[0] ?? 0;

                    return {
                        columns: ['Affected Rows'],
                        rows: [[changes]],
                        rowCount: 1,
                        executionTime: Date.now() - startTime,
                        type: 'dml'
                    };
                }
            } finally {
                const data = db.export();
                db.close();
                fs.writeFileSync(dbPath, Buffer.from(data));
            }
        } catch (e: any) {
            return {
                columns: [], rows: [], rowCount: 0,
                executionTime: Date.now() - startTime,
                error: `SQLite 실행 오류: ${e.message}`,
                type: 'select'
            };
        }
    }

    /**
     * SQLite DDL만 수행 (사용자 쿼리 실행 없이 .ddl.sql 적용 후 .db 저장)
     */
    async executeDdlOnlyOnSqlite(config: SqliteConfig): Promise<QueryResult> {
        const startTime = Date.now();
        try {
            let initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<any>;
            try {
                const sqljs = await import('sql.js');
                initSqlJs = sqljs.default;
            } catch {
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: 'sql.js 패키지가 설치되어 있지 않습니다. `npm install sql.js`를 실행해 주세요.',
                    type: 'select'
                };
            }

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: '워크스페이스가 열려있지 않습니다.',
                    type: 'select'
                };
            }

            const relativeQueryPath = path.relative(workspaceRoot, config.queryFilePath);
            const queryFileDir = path.dirname(relativeQueryPath);
            const queryFileName = path.basename(relativeQueryPath, path.extname(relativeQueryPath));
            const sqliteDir = path.join(workspaceRoot, '.vscode', queryFileDir, queryFileName);

            if (!fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, { recursive: true });
            }

            const dbPath = path.join(sqliteDir, `${config.queryId}.db`);
            const ddlPath = path.join(sqliteDir, `${config.queryId}.ddl.sql`);

            if (!fs.existsSync(ddlPath)) {
                fs.writeFileSync(ddlPath, `-- DDL for ${config.queryId}\n-- 여기에 테이블 생성 DDL을 작성해 주세요.\n-- 예: CREATE TABLE tbl_user (empno TEXT, name TEXT);\n`);
                const ddlUri = vscode.Uri.file(ddlPath);
                await vscode.window.showTextDocument(ddlUri);
                return {
                    columns: [], rows: [], rowCount: 0,
                    executionTime: Date.now() - startTime,
                    error: `DDL 파일이 생성되었습니다: ${ddlPath}\nDDL을 작성한 후 'DDL 수행'을 실행해 주세요.`,
                    type: 'select'
                };
            }

            const SQL = await initSqlJs();
            // 0바이트 파일은 미존재와 동일하게 처리 (sql.js가 빈 버퍼로는 제대로 export하지 않을 수 있음)
            let dbBuffer: Buffer | undefined;
            if (fs.existsSync(dbPath)) {
                const buf = fs.readFileSync(dbPath);
                if (buf.length > 0) dbBuffer = buf;
            }
            const db = new SQL.Database(dbBuffer);

            try {
                const ddlStatements = QueryExecutionService._parseDdlStatements(ddlPath);
                for (const ddl of ddlStatements) {
                    db.run(ddl);
                }

                return {
                    columns: ['메시지'],
                    rows: [['DDL 수행 완료']],
                    rowCount: 1,
                    executionTime: Date.now() - startTime,
                    type: 'select'
                };
            } finally {
                const data = db.export();
                db.close();
                if (data && data.length > 0) {
                    fs.writeFileSync(dbPath, Buffer.from(data));
                }
            }
        } catch (e: any) {
            return {
                columns: [], rows: [], rowCount: 0,
                executionTime: Date.now() - startTime,
                error: `DDL 수행 오류: ${e.message}`,
                type: 'select'
            };
        }
    }
}
