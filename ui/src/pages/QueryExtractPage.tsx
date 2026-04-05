import { useState, useEffect, useCallback } from 'react';
import { getVSCodeAPI, onMessage } from '../vscode';

// ────────────────────────────────────────────────────────────
// 타입 정의
// ────────────────────────────────────────────────────────────
interface InitData {
    queryId: string;
    namespace: string;
    rawSql: string;
    doubleBraceVars: string[]; // {{변수명}} 목록 (중복 제거)
}

type Step = 1 | 2 | 3;

// ────────────────────────────────────────────────────────────
// 유틸리티
// ────────────────────────────────────────────────────────────
/** {{변수명}} → 변수명 배열 (dedup) */
function parseDoubleBraceVars(sql: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(sql)) !== null) {
        seen.add(m[1]);
    }
    return [...seen];
}

/** SQL 하이라이트 (간단 버전) */
function highlightSql(sql: string): string {
    const escape = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let e = escape(sql);
    // 주석
    e = e.replace(/(--[^\n]*)/g, '<span class="qe-cmt">$1</span>');
    // {{변수}} 블록
    e = e.replace(/(\{\{[\s\S]*?\}\})/g, '<span class="qe-ph">$1</span>');
    // SQL 키워드
    const kws = 'SELECT|FROM|WHERE|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|ORDER BY|GROUP BY|HAVING|INSERT INTO|VALUES|UPDATE|SET|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|IS|NULL|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|LIMIT|OFFSET|COUNT|SUM|AVG|MAX|MIN|CREATE|TABLE|DROP|ALTER|INDEX';
    e = e.replace(
        new RegExp(`(<span[^>]*>[\\s\\S]*?<\\/span>)|\\b(${kws})\\b`, 'gi'),
        (m, tag, kw) => (tag ? tag : `<span class="qe-kw">${kw.toUpperCase()}</span>`)
    );
    return e;
}

// ────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────
export default function QueryExtractPage() {
    const [initData, setInitData] = useState<InitData | null>(null);
    const [step, setStep] = useState<Step>(1);

    // 변수 입력값 { varName → value }
    const [varValues, setVarValues] = useState<Record<string, string>>({});

    // Step 2: 치환된 쿼리
    const [replacedSql, setReplacedSql] = useState<string>('');

    // Step 3: JAR 실행 결과
    const [jarOutput, setJarOutput] = useState<string>('');
    const [jarError, setJarError] = useState<string>('');
    const [jarLoading, setJarLoading] = useState(false);

    // Copy 상태
    const [copied, setCopied] = useState(false);

    // ── Extension 메시지 수신 ──
    useEffect(() => {
        const unsubscribe = onMessage((raw) => {
            const msg = raw as Record<string, unknown>;
            if (msg.command === 'init') {
                const data = msg as unknown as InitData & { command: string };
                const vars = parseDoubleBraceVars(data.rawSql);
                setInitData({ ...data, doubleBraceVars: vars });
                // 변수 초기값
                const init: Record<string, string> = {};
                vars.forEach(v => { init[v] = ''; });
                setVarValues(init);
                setStep(1);
            } else if (msg.command === 'velocityExtractResult') {
                setJarLoading(false);
                if (msg.error) {
                    setJarError(String(msg.error));
                    setJarOutput('');
                } else {
                    setJarOutput(String(msg.output ?? ''));
                    setJarError('');
                }
                setStep(3);
            }
        });

        // 준비 완료 알림 → Extension이 init 메시지 보냄
        getVSCodeAPI().postMessage({ command: 'ready' });

        return unsubscribe;
    }, []);

    // ── Step 1 → Step 2: 변수 치환 ──
    const handleConfirm = useCallback(() => {
        if (!initData) return;
        let sql = initData.rawSql;
        Object.entries(varValues).forEach(([varName, val]) => {
            // 전역 replace
            sql = sql.split(`{{${varName}}}`).join(val);
        });
        setReplacedSql(sql);
        setStep(2);
    }, [initData, varValues]);

    // ── Step 2 → Step 3: JAR 실행 ──
    const handleRunJar = useCallback(() => {
        setJarLoading(true);
        setJarOutput('');
        setJarError('');
        getVSCodeAPI().postMessage({
            command: 'runVelocityExtract',
            sql: replacedSql,
        });
    }, [replacedSql]);

    // ── 복사 ──
    const handleCopy = useCallback((text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, []);

    // ── 초기화 전 로딩 ──
    if (!initData) {
        return (
            <div className="qe-loading">
                <div className="qe-spinner" />
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

            {/* ── 스텝 인디케이터 ── */}
            <div className="qe-steps">
                {(['변수 입력', '쿼리 확인', 'Velocity Extract'].map((label, i) => {
                    const s = (i + 1) as Step;
                    return (
                        <div
                            key={s}
                            className={`qe-step${step === s ? ' active' : step > s ? ' done' : ''}`}
                        >
                            <span className="qe-step-num">{s}</span>
                            <span className="qe-step-label">{label}</span>
                            {i < 2 && <span className="qe-step-arrow">→</span>}
                        </div>
                    );
                }))}
            </div>

            {/* ════════════════════════════════
                STEP 1 — {{변수명}} 입력
            ════════════════════════════════ */}
            <div className="qe-section">
                <div className="qe-section-title">① 원본 쿼리</div>
                <pre
                    className="qe-code"
                    dangerouslySetInnerHTML={{ __html: highlightSql(initData.rawSql) }}
                />
            </div>

            <div className="qe-section">
                <div className="qe-section-title">② 변수 치환 입력</div>
                {!hasVars ? (
                    <div className="qe-no-vars">{'{{변수명}} 패턴이 없습니다.'}</div>
                ) : (
                    <div className="qe-var-grid">
                        {initData.doubleBraceVars.map((varName) => (
                            <div key={varName} className="qe-var-row">
                                <div className="qe-var-label">
                                    {'{{'}
                                    <span className="qe-var-name">{varName}</span>
                                    {'}}'}
                                </div>
                                <textarea
                                    className="qe-var-input"
                                    rows={2}
                                    placeholder="치환할 값 입력..."
                                    value={varValues[varName] ?? ''}
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

            {/* ════════════════════════════════
                STEP 2 — 치환된 쿼리
            ════════════════════════════════ */}
            {step >= 2 && (
                <div className="qe-section">
                    <div className="qe-section-title">③ 치환된 쿼리</div>
                    <div className="qe-code-wrap">
                        <button
                            className="qe-copy-btn"
                            title="복사"
                            onClick={() => handleCopy(replacedSql)}
                        >
                            {copied ? '✓' : '📋'}
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
                            {jarLoading ? '⏳ 실행 중...' : '⚡ Velocity Extract 실행'}
                        </button>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════
                STEP 3 — JAR 실행 결과
            ════════════════════════════════ */}
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
        </div>
    );
}
