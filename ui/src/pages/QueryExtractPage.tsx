import { useState, useEffect, useCallback } from "react";
import { getVSCodeAPI, onMessage } from "../vscode";

// ────────────────────────────────────────────────────────────
// 타입 정의
// ────────────────────────────────────────────────────────────
interface InitData {
  queryId: string;
  namespace: string;
  rawSql: string;
  doubleBraceVars: string[];
}

type Step = 1 | 2 | 3;
type TabId = "extract" | "analysis";

interface TableEntry {
  name: string;
  alias?: string;
  source: "FROM" | "JOIN";
  joinType?: string;
}

interface AnalysisResult {
  queryType: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "UNKNOWN";
  tables: TableEntry[];
  selectColumns: string[];
  whereColumns: string[];
  joinCount: number;
  subqueryCount: number;
  hasGroupBy: boolean;
  hasOrderBy: boolean;
  hasUnion: boolean;
  complexityScore: number;
  complexityLabel: "LOW" | "MEDIUM" | "HIGH";
  parseWarnings: string[];
}

// ────────────────────────────────────────────────────────────
// SQL 전처리 — Velocity / CDATA / 특수구문 제거
// ────────────────────────────────────────────────────────────
function cleanSqlForAnalysis(rawSql: string): {
  sql: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let sql = rawSql;

  // CDATA 언래핑
  sql = sql.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  // Velocity 디렉티브 제거 (줄 단위)
  const velocityHits = (
    sql.match(
      /#(?:if|elseif|else|end|foreach|set|macro|stop|parse|include|evaluate|define|break|return)\b/gi,
    ) || []
  ).length;
  if (velocityHits > 0) {
    warnings.push(`Velocity 디렉티브 ${velocityHits}개 제거됨`);
    sql = sql.replace(
      /#(?:if|elseif|else|end|foreach|set|macro|stop|parse|include|evaluate|define|break|return)\b[^\n]*/gi,
      "",
    );
  }

  // {{...}} 더블 중괄호 블록 → 플레이스홀더
  const dblCount = (sql.match(/\{\{[\s\S]*?\}\}/g) || []).length;
  if (dblCount > 0) {
    warnings.push(`{{변수}} 블록 ${dblCount}개 대체됨`);
    sql = sql.replace(/\{\{[\s\S]*?\}\}/g, "'?'");
  }

  // #{...} iBatis 파라미터 → ?
  sql = sql.replace(/#\{[^}]*\}/g, "?");

  // :varname 바인드 변수 → ?  (세션 변수 :session.x 포함)
  sql = sql.replace(/:[a-zA-Z_][a-zA-Z0-9_.]*/g, "?");

  // 남은 XML 태그 제거
  sql = sql.replace(/<[^>]+>/g, "");

  // SQL 주석 제거
  sql = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 연속 공백 정리
  sql = sql.replace(/\s+/g, " ").trim();

  return { sql, warnings };
}

// ────────────────────────────────────────────────────────────
// SQL 분석 유틸
// ────────────────────────────────────────────────────────────
const SQL_KEYWORDS = new Set([
  "SELECT","FROM","WHERE","AND","OR","NOT","IN","EXISTS","BETWEEN","LIKE",
  "ORDER","BY","GROUP","HAVING","INSERT","INTO","VALUES","UPDATE","SET",
  "DELETE","JOIN","LEFT","RIGHT","INNER","OUTER","FULL","CROSS","ON","AS",
  "IS","NULL","CASE","WHEN","THEN","ELSE","END","DISTINCT","UNION","ALL",
  "LIMIT","OFFSET","COUNT","SUM","AVG","MAX","MIN","TOP","WITH","TABLE",
  "INDEX","ROWNUM","CONNECT","START","PRIOR","LEVEL","NOCYCLE","SIBLINGS",
  "FETCH","NEXT","ROWS","ONLY",
]);

function isKeyword(w: string): boolean {
  return SQL_KEYWORDS.has(w.toUpperCase());
}

function splitByComma(s: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      result.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) result.push(cur);
  return result;
}

function extractTables(sql: string): TableEntry[] {
  const tables: TableEntry[] = [];
  const seen = new Set<string>();

  const addTable = (
    name: string,
    alias: string | undefined,
    source: TableEntry["source"],
    joinType?: string,
  ) => {
    const key = name.toUpperCase();
    if (!seen.has(key) && !isKeyword(name) && name !== "?" && name.length > 0) {
      seen.add(key);
      tables.push({
        name: key,
        alias: alias && !isKeyword(alias) && alias.toUpperCase() !== "ON" ? alias : undefined,
        source,
        joinType,
      });
    }
  };

  // FROM 절 — 쉼표 구분 테이블 목록 추출
  // "FROM tableA a, tableB b WHERE" 형태
  const fromRe =
    /\bFROM\s+([\s\S]+?)(?=\s+(?:WHERE|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|JOIN|GROUP|ORDER|HAVING|UNION|ON)\b|$)/i;
  const fromMatch = sql.match(fromRe);
  if (fromMatch) {
    const parts = splitByComma(fromMatch[1]);
    for (const p of parts) {
      const words = p
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
      if (words.length > 0) {
        const name = words[0].replace(/[();]/g, "");
        const alias =
          words[1] && !isKeyword(words[1]) ? words[1].replace(/[();]/g, "") : undefined;
        addTable(name, alias, "FROM");
      }
    }
  }

  // JOIN 절
  const joinRe =
    /\b((?:(?:INNER|LEFT|RIGHT|FULL|CROSS|OUTER)\s+)*JOIN)\s+([a-zA-Z0-9_.]+)(?:\s+([a-zA-Z0-9_]+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = joinRe.exec(sql)) !== null) {
    const joinType = m[1].trim().toUpperCase();
    const name = m[2].replace(/[();]/g, "");
    const alias = m[3] ? m[3].replace(/[();]/g, "") : undefined;
    addTable(name, alias, "JOIN", joinType);
  }

  return tables;
}

function extractSelectColumns(sql: string): string[] {
  const m = sql.match(/\bSELECT\s+([\s\S]+?)\s+FROM\b/i);
  if (!m) return [];

  const cols = splitByComma(m[1]);
  return cols
    .map((col) => {
      const t = col.trim();
      if (!t) return null;
      // AS 별칭
      const asM = t.match(/\bAS\s+([a-zA-Z0-9_"]+)\s*$/i);
      if (asM) return asM[1].replace(/"/g, "").toUpperCase();
      // *
      if (t === "*" || /\.\*$/.test(t)) return t.toUpperCase();
      // 함수 호출
      if (/[()]/.test(t)) {
        const fn = t.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        return fn ? `${fn[1].toUpperCase()}(...)` : "EXPR";
      }
      // table.column
      const words = t.split(/\s+/);
      const last = words[words.length - 1];
      const dotIdx = last.lastIndexOf(".");
      return (dotIdx >= 0 ? last.slice(dotIdx + 1) : last).toUpperCase();
    })
    .filter((c): c is string => c !== null);
}

function extractWhereColumns(sql: string): string[] {
  const m = sql.match(
    /\bWHERE\s+([\s\S]+?)(?:\s+(?:GROUP|ORDER|HAVING|UNION|LIMIT|FETCH)\b|$)/i,
  );
  if (!m) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  const condRe =
    /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*(?:=|!=|<>|<=|>=|<|>|\bLIKE\b|\bIN\b|\bBETWEEN\b|\bIS\b)/gi;
  let cm: RegExpExecArray | null;
  while ((cm = condRe.exec(m[1])) !== null) {
    const col = cm[1].toUpperCase();
    const colName = col.includes(".") ? col.split(".").pop()! : col;
    if (!isKeyword(colName) && !seen.has(col)) {
      seen.add(col);
      result.push(col);
    }
  }
  return result;
}

function analyzeSql(rawSql: string): AnalysisResult {
  const { sql, warnings } = cleanSqlForAnalysis(rawSql);
  const upper = sql.toUpperCase();

  // 쿼리 유형
  let queryType: AnalysisResult["queryType"] = "UNKNOWN";
  if (/^\s*SELECT\b/i.test(sql)) queryType = "SELECT";
  else if (/^\s*INSERT\b/i.test(sql)) queryType = "INSERT";
  else if (/^\s*UPDATE\b/i.test(sql)) queryType = "UPDATE";
  else if (/^\s*DELETE\b/i.test(sql)) queryType = "DELETE";

  const tables = extractTables(sql);
  const selectColumns = queryType === "SELECT" ? extractSelectColumns(sql) : [];
  const whereColumns = extractWhereColumns(sql);

  const joinCount = (upper.match(/\bJOIN\b/g) || []).length;
  const subqueryCount = Math.max(0, (upper.match(/\bSELECT\b/g) || []).length - 1);
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(sql);
  const hasOrderBy = /\bORDER\s+BY\b/i.test(sql);
  const hasUnion = /\bUNION\b/i.test(sql);

  // 복잡도 점수 (0–10)
  let score = Math.min(joinCount * 2, 6) + Math.min(subqueryCount * 2, 4);
  if (hasGroupBy) score += 1;
  if (hasUnion) score += 1;
  score = Math.min(score, 10);

  const complexityLabel: AnalysisResult["complexityLabel"] =
    score <= 2 ? "LOW" : score <= 5 ? "MEDIUM" : "HIGH";

  return {
    queryType,
    tables,
    selectColumns,
    whereColumns,
    joinCount,
    subqueryCount,
    hasGroupBy,
    hasOrderBy,
    hasUnion,
    complexityScore: score,
    complexityLabel,
    parseWarnings: warnings,
  };
}

// ────────────────────────────────────────────────────────────
// SQL 하이라이트 (간단 버전)
// ────────────────────────────────────────────────────────────
function highlightSql(sql: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let e = escape(sql);
  e = e.replace(/(--[^\n]*)/g, '<span class="qe-cmt">$1</span>');
  e = e.replace(/(\{\{[\s\S]*?\}\})/g, '<span class="qe-ph">$1</span>');
  const kws =
    "SELECT|FROM|WHERE|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|ORDER BY|GROUP BY|HAVING|INSERT INTO|VALUES|UPDATE|SET|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|IS|NULL|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|LIMIT|OFFSET|COUNT|SUM|AVG|MAX|MIN|CREATE|TABLE|DROP|ALTER|INDEX|CONNECT BY|START WITH|ROWNUM|FETCH|NEXT|ROWS|ONLY";
  e = e.replace(
    new RegExp(`(<span[^>]*>[\\s\\S]*?<\\/span>)|\\b(${kws})\\b`, "gi"),
    (_m, tag, kw) =>
      tag ? tag : `<span class="qe-kw">${kw.toUpperCase()}</span>`,
  );
  return e;
}

// ────────────────────────────────────────────────────────────
// 복잡도 배지 색상
// ────────────────────────────────────────────────────────────
function complexityClass(label: AnalysisResult["complexityLabel"]): string {
  return label === "LOW"
    ? "qe-badge qe-badge-low"
    : label === "MEDIUM"
      ? "qe-badge qe-badge-mid"
      : "qe-badge qe-badge-high";
}

function queryTypeClass(qt: AnalysisResult["queryType"]): string {
  const map: Record<string, string> = {
    SELECT: "qe-badge qe-badge-select",
    INSERT: "qe-badge qe-badge-insert",
    UPDATE: "qe-badge qe-badge-update",
    DELETE: "qe-badge qe-badge-delete",
    UNKNOWN: "qe-badge",
  };
  return map[qt] ?? "qe-badge";
}

// ────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────────────
export default function QueryExtractPage() {
  const [initData, setInitData] = useState<InitData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("extract");
  const [step, setStep] = useState<Step>(1);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [replacedSql, setReplacedSql] = useState<string>("");
  const [jarOutput, setJarOutput] = useState<string>("");
  const [jarError, setJarError] = useState<string>("");
  const [jarLoading, setJarLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // ── Extension 메시지 수신 ──
  useEffect(() => {
    const unsubscribe = onMessage((raw) => {
      const msg = raw as Record<string, unknown>;
      if (msg.command === "init") {
        const data = msg as unknown as InitData & { command: string };
        const vars = parseDoubleBraceVars(data.rawSql);
        const newInit: InitData = { ...data, doubleBraceVars: vars };
        setInitData(newInit);
        const init: Record<string, string> = {};
        vars.forEach((v) => { init[v] = ""; });
        setVarValues(init);
        setStep(1);
        setReplacedSql("");
        setJarOutput("");
        setJarError("");
        // 분석 자동 실행
        setAnalysisResult(analyzeSql(data.rawSql));
      } else if (msg.command === "velocityExtractResult") {
        setJarLoading(false);
        if (msg.error) {
          setJarError(String(msg.error));
          setJarOutput("");
        } else {
          setJarOutput(String(msg.output ?? ""));
          setJarError("");
        }
        setStep(3);
      }
    });

    getVSCodeAPI().postMessage({ command: "ready" });
    return unsubscribe;
  }, []);

  const handleConfirm = useCallback(() => {
    if (!initData) return;
    let sql = initData.rawSql;
    Object.entries(varValues).forEach(([varName, val]) => {
      sql = sql.split(`{{${varName}}}`).join(val);
    });
    setReplacedSql(sql);
    setStep(2);
  }, [initData, varValues]);

  const handleRunJar = useCallback(() => {
    setJarLoading(true);
    setJarOutput("");
    setJarError("");
    getVSCodeAPI().postMessage({ command: "runVelocityExtract", sql: replacedSql });
  }, [replacedSql]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  // ── 로딩 ──
  if (!initData) {
    return (
      <div className="qe-loading">
        <div className="qe-spinner" aria-hidden="true" />
        <span>쿼리 정보 로딩 중...</span>
      </div>
    );
  }

  const hasVars = initData.doubleBraceVars.length > 0;

  return (
    <div className="qe-root">
      {/* ── 헤더 ── */}
      <div className="qe-header">
        <div className="qe-title">
          <span className="qe-label">Query Extract</span>
          <span className="qe-queryid">{initData.queryId}</span>
        </div>
        {initData.namespace && (
          <div className="qe-ns">namespace: {initData.namespace}</div>
        )}
      </div>

      {/* ── 탭 내비게이션 ── */}
      <div className="qe-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "extract"}
          className={`qe-tab${activeTab === "extract" ? " qe-tab-active" : ""}`}
          onClick={() => setActiveTab("extract")}
        >
          SQL Extract
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "analysis"}
          className={`qe-tab${activeTab === "analysis" ? " qe-tab-active" : ""}`}
          onClick={() => setActiveTab("analysis")}
        >
          분석
          {analysisResult && (
            <span
              className={complexityClass(analysisResult.complexityLabel)}
              style={{ marginLeft: 6, fontSize: 10 }}
            >
              {analysisResult.complexityLabel}
            </span>
          )}
        </button>
      </div>

      {/* ════════════════════════════════
          TAB: SQL Extract
          ════════════════════════════════ */}
      {activeTab === "extract" && (
        <>
          {/* 스텝 인디케이터 */}
          <div className="qe-steps">
            {(["변수 입력", "쿼리 확인", "Velocity Extract"] as const).map(
              (label, i) => {
                const s = (i + 1) as Step;
                return (
                  <div
                    key={s}
                    className={`qe-step${step === s ? " active" : step > s ? " done" : ""}`}
                  >
                    <span className="qe-step-num">{s}</span>
                    <span className="qe-step-label">{label}</span>
                    {i < 2 && <span className="qe-step-arrow">→</span>}
                  </div>
                );
              },
            )}
          </div>

          {/* ① 원본 쿼리 */}
          <div className="qe-section">
            <div className="qe-section-title">① 원본 쿼리</div>
            <pre
              className="qe-code"
              dangerouslySetInnerHTML={{ __html: highlightSql(initData.rawSql) }}
            />
          </div>

          {/* ② 변수 치환 */}
          <div className="qe-section">
            <div className="qe-section-title">② 변수 치환 입력</div>
            {!hasVars ? (
              <div className="qe-no-vars">{"{{변수명}} 패턴이 없습니다."}</div>
            ) : (
              <div className="qe-var-grid">
                {initData.doubleBraceVars.map((varName) => (
                  <div key={varName} className="qe-var-row">
                    <div className="qe-var-label">
                      {"{{"}
                      <span className="qe-var-name">{varName}</span>
                      {"}}"}
                    </div>
                    <textarea
                      className="qe-var-input"
                      rows={2}
                      placeholder="치환할 값 입력..."
                      value={varValues[varName] ?? ""}
                      onChange={(e) =>
                        setVarValues((prev) => ({
                          ...prev,
                          [varName]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="qe-btn-row">
              <button className="qe-btn qe-btn-primary" onClick={handleConfirm}>
                ✅ 확인 (치환 적용)
              </button>
            </div>
          </div>

          {/* ③ 치환된 쿼리 */}
          {step >= 2 && (
            <div className="qe-section">
              <div className="qe-section-title">③ 치환된 쿼리</div>
              <div className="qe-code-wrap">
                <button
                  className="qe-copy-btn"
                  title="복사"
                  aria-label="복사"
                  onClick={() => handleCopy(replacedSql)}
                >
                  {copied ? "✓" : "📋"}
                </button>
                <pre
                  className="qe-code"
                  dangerouslySetInnerHTML={{ __html: highlightSql(replacedSql) }}
                />
              </div>
              <div className="qe-btn-row">
                <button
                  className="qe-btn qe-btn-run"
                  onClick={handleRunJar}
                  disabled={jarLoading}
                >
                  {jarLoading ? "⏳ 실행 중..." : "⚡ Velocity Extract 실행"}
                </button>
              </div>
            </div>
          )}

          {/* ④ JAR 실행 결과 */}
          {step >= 3 && (
            <div className="qe-section">
              <div className="qe-section-title">④ Velocity Extract 결과</div>
              {jarError ? (
                <div className="qe-error">{jarError}</div>
              ) : (
                <pre className="qe-code qe-result">{jarOutput}</pre>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════
          TAB: 분석
          ════════════════════════════════ */}
      {activeTab === "analysis" && analysisResult && (
        <div className="qe-analysis">
          {/* 파싱 경고 */}
          {analysisResult.parseWarnings.length > 0 && (
            <div className="qe-analysis-warn">
              <span className="qe-analysis-warn-icon">⚠</span>
              <span>일부 분석 제한됨 — {analysisResult.parseWarnings.join(" / ")}</span>
            </div>
          )}

          {/* 요약 헤더 */}
          <div className="qe-analysis-summary">
            <div className="qe-analysis-summary-item">
              <span className="qe-analysis-summary-label">쿼리 유형</span>
              <span className={queryTypeClass(analysisResult.queryType)}>
                {analysisResult.queryType}
              </span>
            </div>
            <div className="qe-analysis-summary-item">
              <span className="qe-analysis-summary-label">복잡도</span>
              <span className={complexityClass(analysisResult.complexityLabel)}>
                {analysisResult.complexityLabel}
              </span>
              <span className="qe-analysis-summary-score">
                {analysisResult.complexityScore}/10
              </span>
            </div>
            <div className="qe-analysis-summary-item">
              <span className="qe-analysis-summary-label">JOIN</span>
              <span className="qe-analysis-summary-val">{analysisResult.joinCount}</span>
            </div>
            <div className="qe-analysis-summary-item">
              <span className="qe-analysis-summary-label">서브쿼리</span>
              <span className="qe-analysis-summary-val">
                {analysisResult.subqueryCount}
              </span>
            </div>
            {analysisResult.hasGroupBy && (
              <div className="qe-analysis-summary-item">
                <span className="qe-badge qe-badge-feature">GROUP BY</span>
              </div>
            )}
            {analysisResult.hasOrderBy && (
              <div className="qe-analysis-summary-item">
                <span className="qe-badge qe-badge-feature">ORDER BY</span>
              </div>
            )}
            {analysisResult.hasUnion && (
              <div className="qe-analysis-summary-item">
                <span className="qe-badge qe-badge-feature">UNION</span>
              </div>
            )}
          </div>

          {/* FROM / JOIN 테이블 */}
          <div className="qe-analysis-block">
            <div className="qe-analysis-block-title">
              테이블 ({analysisResult.tables.length})
            </div>
            {analysisResult.tables.length === 0 ? (
              <div className="qe-analysis-empty">테이블을 추출하지 못했습니다.</div>
            ) : (
              <table className="qe-analysis-table">
                <thead>
                  <tr>
                    <th>테이블명</th>
                    <th>별칭</th>
                    <th>참조 방식</th>
                  </tr>
                </thead>
                <tbody>
                  {analysisResult.tables.map((t, i) => (
                    <tr key={i}>
                      <td className="qe-analysis-td-name">{t.name}</td>
                      <td className="qe-analysis-td-alias">{t.alias ?? "—"}</td>
                      <td>
                        <span
                          className={`qe-badge ${t.source === "FROM" ? "qe-badge-from" : "qe-badge-join"}`}
                        >
                          {t.joinType ?? t.source}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* SELECT 컬럼 */}
          {analysisResult.queryType === "SELECT" && (
            <div className="qe-analysis-block">
              <div className="qe-analysis-block-title">
                SELECT 컬럼 ({analysisResult.selectColumns.length})
              </div>
              {analysisResult.selectColumns.length === 0 ? (
                <div className="qe-analysis-empty">컬럼을 추출하지 못했습니다.</div>
              ) : (
                <div className="qe-analysis-chips">
                  {analysisResult.selectColumns.map((c, i) => (
                    <span key={i} className="qe-analysis-chip">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* WHERE 컬럼 */}
          <div className="qe-analysis-block">
            <div className="qe-analysis-block-title">
              WHERE 조건 컬럼 ({analysisResult.whereColumns.length})
            </div>
            {analysisResult.whereColumns.length === 0 ? (
              <div className="qe-analysis-empty">WHERE 조건이 없거나 추출하지 못했습니다.</div>
            ) : (
              <div className="qe-analysis-chips">
                {analysisResult.whereColumns.map((c, i) => (
                  <span key={i} className="qe-analysis-chip qe-analysis-chip-where">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 복잡도 게이지 */}
          <div className="qe-analysis-block">
            <div className="qe-analysis-block-title">복잡도 분석</div>
            <div className="qe-analysis-gauge-track">
              <div
                className={`qe-analysis-gauge-bar qe-analysis-gauge-${analysisResult.complexityLabel.toLowerCase()}`}
                style={{ width: `${analysisResult.complexityScore * 10}%` }}
              />
            </div>
            <div className="qe-analysis-gauge-labels">
              <span>LOW</span>
              <span>MEDIUM</span>
              <span>HIGH</span>
            </div>
            <ul className="qe-analysis-complexity-list">
              {analysisResult.joinCount > 0 && (
                <li>JOIN {analysisResult.joinCount}개 (+{Math.min(analysisResult.joinCount * 2, 6)}점)</li>
              )}
              {analysisResult.subqueryCount > 0 && (
                <li>서브쿼리 {analysisResult.subqueryCount}개 (+{Math.min(analysisResult.subqueryCount * 2, 4)}점)</li>
              )}
              {analysisResult.hasGroupBy && <li>GROUP BY 사용 (+1점)</li>}
              {analysisResult.hasUnion && <li>UNION 사용 (+1점)</li>}
              {analysisResult.complexityScore === 0 && <li>단순 쿼리 (JOIN/서브쿼리 없음)</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 유틸
// ────────────────────────────────────────────────────────────
function parseDoubleBraceVars(sql: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(sql)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}
