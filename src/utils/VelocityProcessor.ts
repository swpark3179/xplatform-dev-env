/**
 * Velocity 템플릿 문법을 처리하는 프로세서
 * 
 * 지원 지시자:
 * - #set($var = value)
 * - #if($var) / #elseif($var) / #elif($var) / #else / #end
 * - #foreach($item in $list) / #end
 * - #macro(name ...) / #end (제거)
 * - #parse("...") / #include("...") (주석 변환)
 * - $변수 치환
 * - <![CDATA[ ... ]]> 제거
 */
export class VelocityProcessor {

    /**
     * Velocity 템플릿에서 사용된 변수명 추출 (최상위 식별자만: $var, $var.length() → var)
     */
    static extractVariables(template: string): string[] {
        const vars = new Set<string>();

        const addRoot = (name: string) => {
            const root = name.includes('.') ? name.split('.')[0] : name;
            vars.add(root);
        };

        // $var, ${var}, $!{var} 또는 $var.method() — 첫 식별자만 수집
        const varRegex = /\$!?\{?([a-zA-Z_]\w*)(?:\.[a-zA-Z_]\w*(?:\s*\([^)]*\))?)*\}?/g;
        let m: RegExpExecArray | null;
        while ((m = varRegex.exec(template)) !== null) {
            addRoot(m[1]);
        }

        // #if / #elseif / #elif 조건 (괄호 균형으로 조건 추출 후 변수 추출)
        let searchStart = 0;
        for (;;) {
            const ifStart = template.slice(searchStart).search(/#(?:if|elseif|elif)\s*\(/i);
            if (ifStart === -1) break;
            const openIdx = searchStart + ifStart + template.slice(searchStart + ifStart).indexOf('(');
            const closeIdx = this._findBalancedParenClose(template, openIdx);
            if (closeIdx === -1) {
                searchStart = openIdx + 1;
                continue;
            }
            const cond = template.slice(openIdx + 1, closeIdx);
            const innerVarRegex = /\$!?\{?([a-zA-Z_]\w*)(?:\.[a-zA-Z_]\w*(?:\s*\([^)]*\))?)*\}?/g;
            let iv: RegExpExecArray | null;
            while ((iv = innerVarRegex.exec(cond)) !== null) {
                addRoot(iv[1]);
            }
            searchStart = closeIdx + 1;
        }

        // #foreach($item in $list)
        const forRegex = /#foreach\s*\(\s*\$(\w+)\s+in\s+\$(\w+)\s*\)/gi;
        while ((m = forRegex.exec(template)) !== null) {
            vars.add(m[2]);
        }

        // #set($var = ...) 우변
        const setRegex = /#set\s*\(\s*\$(\w+)\s*=\s*([^)]+)\)/gi;
        while ((m = setRegex.exec(template)) !== null) {
            const rhsVarRegex = /\$!?\{?([a-zA-Z_]\w*)(?:\.[a-zA-Z_]\w*(?:\s*\([^)]*\))?)*\}?/g;
            let rv: RegExpExecArray | null;
            while ((rv = rhsVarRegex.exec(m[2])) !== null) {
                addRoot(rv[1]);
            }
        }

        const builtins = ['foreach', 'velocityCount', 'velocityHasNext'];
        builtins.forEach(b => vars.delete(b));

        return Array.from(vars);
    }

    /**
     * Velocity 템플릿을 처리하여 SQL 문자열을 생성
     * @param template 원본 Velocity 템플릿
     * @param variables 변수명 → 값 맵
     * @returns 처리된 SQL 문자열
     */
    static process(template: string, variables: Map<string, string>): string {
        let result = template;

        // 1단계: #set 처리 — 변수 등록
        result = this._processSet(result, variables);

        // 2단계: #foreach 처리
        result = this._processForeach(result, variables);

        // 3단계: #if / #elseif / #elif / #else / #end 블록 처리
        result = this._processIfBlocks(result, variables);

        // 4단계: #macro 블록 제거 (정의 부분)
        result = result.replace(/#macro\s*\([^)]*\)[\s\S]*?#end/gi, '');

        // 5단계: #parse / #include → 주석 변환
        result = result.replace(/#parse\s*\(\s*"([^"]+)"\s*\)/gi, '/* #parse: $1 */');
        result = result.replace(/#include\s*\(\s*"([^"]+)"\s*\)/gi, '/* #include: $1 */');

        // 6단계: $변수 치환
        result = this._substituteVariables(result, variables);

        // 7단계: CDATA 제거
        result = this._removeCDATA(result);

        // 8단계: 빈 줄 정리
        result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

        return result.trim();
    }

    /**
     * CDATA 섹션 제거
     */
    static removeCDATA(text: string): string {
        return this._removeCDATA(text);
    }

    private static _removeCDATA(text: string): string {
        // <![CDATA[ ... ]]> 를 내부 내용만 남기고 제거
        return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    }

    /**
     * #set($var = value) 처리
     */
    private static _processSet(template: string, variables: Map<string, string>): string {
        const setRegex = /#set\s*\(\s*\$(\w+)\s*=\s*([^)]+)\)/gi;
        return template.replace(setRegex, (_match, varName: string, value: string) => {
            let resolved = value.trim();
            // 문자열 리터럴인 경우 따옴표 제거
            if ((resolved.startsWith('"') && resolved.endsWith('"')) ||
                (resolved.startsWith("'") && resolved.endsWith("'"))) {
                resolved = resolved.slice(1, -1);
            }
            // 변수 참조 치환
            resolved = this._substituteVariables(resolved, variables);
            variables.set(varName, resolved);
            return ''; // #set 라인 제거
        });
    }

    /**
     * #foreach($item in $list) ... #end 처리
     */
    private static _processForeach(template: string, variables: Map<string, string>): string {
        const foreachRegex = /#foreach\s*\(\s*\$(\w+)\s+in\s+\$(\w+)\s*\)([\s\S]*?)#end/gi;

        return template.replace(foreachRegex, (_match, itemVar: string, listVar: string, body: string) => {
            const listValue = variables.get(listVar) || '[]';
            let items: string[];
            try {
                const parsed = JSON.parse(listValue);
                items = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
            } catch {
                // 콤마 구분 문자열로 시도
                items = listValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
            }

            if (items.length === 0) {
                return '';
            }

            const results: string[] = [];
            for (const item of items) {
                let expanded = body;
                // $item 또는 ${item} 치환
                expanded = expanded.replace(
                    new RegExp(`\\$\\{?${this._escapeRegex(itemVar)}\\}?`, 'g'),
                    item
                );
                results.push(expanded);
            }

            return results.join('');
        });
    }

    /**
     * 열린 괄호 위치에서 균형이 맞는 닫는 괄호 인덱스 반환 (포함).
     * openIdx는 여는 '(' 의 위치.
     */
    private static _findBalancedParenClose(text: string, openIdx: number): number {
        let depth = 1;
        for (let i = openIdx + 1; i < text.length; i++) {
            if (text[i] === '(') depth++;
            else if (text[i] === ')') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    /**
     * #if / #elseif / #elif / #else / #end 블록 처리
     * 조건식은 괄호 균형으로 파싱 (예: #if( $var.length() > 0 ) 지원)
     */
    private static _processIfBlocks(template: string, variables: Map<string, string>): string {
        let result = template;
        let maxIterations = 50;

        while (maxIterations-- > 0) {
            const ifStart = result.search(/#if\s*\(/i);
            if (ifStart === -1) break;

            const openParen = result.indexOf('(', ifStart);
            const closeParen = this._findBalancedParenClose(result, openParen);
            if (closeParen === -1) break;

            const endMatch = result.slice(closeParen + 1).match(/\s*#end\b/i);
            if (!endMatch) break;

            const endIdx = closeParen + 1 + endMatch.index! + endMatch[0].length;
            const fullBlock = result.slice(ifStart, endIdx);
            const processed = this._processOneIfBlock(fullBlock, variables);
            result = result.slice(0, ifStart) + processed + result.slice(endIdx);
        }

        return result;
    }

    /**
     * 단일 #if 블록 처리 (조건식은 괄호 균형으로 추출)
     */
    private static _processOneIfBlock(block: string, variables: Map<string, string>): string {
        const endIdx = block.search(/\s#end\s*$/i);
        const beforeEnd = endIdx === -1 ? block : block.slice(0, endIdx);
        const ifStart = beforeEnd.search(/#if\s*\(/i);
        if (ifStart === -1) return beforeEnd;

        const openParen = beforeEnd.indexOf('(', ifStart);
        const closeParen = this._findBalancedParenClose(beforeEnd, openParen);
        if (closeParen === -1) return beforeEnd;

        const condition = beforeEnd.slice(openParen + 1, closeParen).trim();
        let inner = beforeEnd.slice(closeParen + 1).trim();

        // 분기들 파싱: #elseif( balanced ) / #else
        const branches: { condition: string | null; body: string }[] = [];
        let currentCondition: string | null = condition;
        let currentBody = '';

        let pos = 0;
        while (pos < inner.length) {
            const tail = inner.slice(pos);
            const elifMatch = tail.match(/^\s*#(?:elseif|elif)\s*\(/i);
            const elseMatch = tail.match(/^\s*#else\b/i);

            if (elifMatch) {
                const elifOpenInTail = elifMatch[0].length - 1; // index of '(' in tail
                const elifOpenInInner = pos + elifOpenInTail;
                const elifClose = this._findBalancedParenClose(inner, elifOpenInInner);
                if (elifClose === -1) {
                    currentBody += inner.slice(pos);
                    break;
                }
                branches.push({ condition: currentCondition, body: currentBody });
                currentCondition = inner.slice(elifOpenInInner + 1, elifClose).trim();
                currentBody = '';
                pos = elifClose + 1;
            } else if (elseMatch) {
                branches.push({ condition: currentCondition, body: currentBody });
                currentCondition = null;
                currentBody = '';
                pos += elseMatch.index! + elseMatch[0].length;
            } else {
                const nextElif = inner.slice(pos + 1).search(/#(?:elseif|elif)\s*\(/i);
                const nextElse = inner.slice(pos + 1).search(/#else\b/i);
                let next = -1;
                if (nextElif >= 0 && (nextElse < 0 || nextElif < nextElse)) next = pos + 1 + nextElif;
                else if (nextElse >= 0) next = pos + 1 + nextElse;
                if (next === -1) {
                    currentBody += inner.slice(pos);
                    break;
                }
                currentBody += inner.slice(pos, next);
                pos = next;
            }
        }
        branches.push({ condition: currentCondition, body: currentBody });

        for (const branch of branches) {
            if (branch.condition === null) return branch.body;
            if (this._evaluateCondition(branch.condition, variables)) return branch.body;
        }
        return '';
    }

    /**
     * $var.length() 또는 $var.size() 값 (문자열 길이, 없으면 0)
     */
    private static _getVarLength(varName: string, variables: Map<string, string>): number {
        const value = variables.get(varName);
        if (value === undefined || value === null) return 0;
        return String(value).length;
    }

    /**
     * 조건식 평가 ($var.length() > 0, 단순 변수, 비교, &&/|| 지원)
     */
    private static _evaluateCondition(condition: string, variables: Map<string, string>): boolean {
        let cond = condition.trim();

        const negated = cond.startsWith('!');
        if (negated) cond = cond.substring(1).trim();

        // $var.equals("") / $var.equals("value")
        const equalsMatch = cond.match(/^\$\{?(\w+)\}?\.equals\s*\(\s*["']([^"']*)["']\s*\)\s*$/);
        if (equalsMatch) {
            const varName = equalsMatch[1];
            const expected = equalsMatch[2];
            const value = variables.get(varName);
            const actual = value === undefined ? '' : String(value);
            const result = actual === expected;
            return negated ? !result : result;
        }

        // $var.length() > 0, $var.length() >= 1 등
        const lengthCompareMatch = cond.match(/^\$\{?(\w+)\}?\.(?:length|size)\s*\(\s*\)\s*(>|>=|!=|==|<|<=)\s*(\d+)\s*$/);
        if (lengthCompareMatch) {
            const varName = lengthCompareMatch[1];
            const op = lengthCompareMatch[2];
            const num = parseInt(lengthCompareMatch[3], 10);
            const len = this._getVarLength(varName, variables);
            let result = false;
            switch (op) {
                case '>': result = len > num; break;
                case '>=': result = len >= num; break;
                case '<': result = len < num; break;
                case '<=': result = len <= num; break;
                case '==': result = len === num; break;
                case '!=': result = len !== num; break;
                default: result = len > 0;
            }
            return negated ? !result : result;
        }

        // 단순 $var (truthy)
        const varMatch = cond.match(/^\$\{?(\w+)\}?$/);
        if (varMatch) {
            const value = variables.get(varMatch[1]);
            const truthy = value !== undefined && value !== '' && value !== 'false' && value !== '0' && value !== 'null';
            return negated ? !truthy : truthy;
        }

        // $var == "value" / $var != "value"
        const compareMatch = cond.match(/^\$\{?(\w+)\}?\s*(==|!=|eq|ne)\s*["']?([^"']*)["']?$/);
        if (compareMatch) {
            const value = variables.get(compareMatch[1]) || '';
            const op = compareMatch[2];
            const expected = compareMatch[3];
            const equals = value === expected;
            const isEqual = op === '==' || op === 'eq';
            const result = isEqual ? equals : !equals;
            return negated ? !result : result;
        }

        if (cond.includes('&&')) {
            const parts = cond.split('&&');
            const allTrue = parts.every(p => this._evaluateCondition(p.trim(), variables));
            return negated ? !allTrue : allTrue;
        }
        if (cond.includes('||')) {
            const parts = cond.split('||');
            const anyTrue = parts.some(p => this._evaluateCondition(p.trim(), variables));
            return negated ? !anyTrue : anyTrue;
        }

        const hasValue = cond.length > 0;
        return negated ? !hasValue : hasValue;
    }

    /**
     * $변수 치환 — 최상위 변수명만 치환 ($var.메서드() 는 치환하지 않음)
     */
    private static _substituteVariables(text: string, variables: Map<string, string>): string {
        // $!{var} 형태
        let result = text.replace(/\$!\{([a-zA-Z_]\w*)\}/g, (_m, varName: string) => {
            return variables.has(varName) ? variables.get(varName)! : `\$!{${varName}}`;
        });

        // ${var} 형태 (항상 완전한 참조)
        result = result.replace(/\$\{([a-zA-Z_]\w*)\}/g, (_m, varName: string) => {
            return variables.has(varName) ? variables.get(varName)! : `\${${varName}}`;
        });

        // $var 형태 — 점(.)으로 이어지지 않을 때만 치환 (예: $system.length() 의 $system은 치환 안 함; 조건은 이미 처리됨)
        result = result.replace(/\$([a-zA-Z_]\w*)(?!\.)/g, (_m, varName: string) => {
            return variables.has(varName) ? variables.get(varName)! : `$${varName}`;
        });

        return result;
    }

    private static _escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
