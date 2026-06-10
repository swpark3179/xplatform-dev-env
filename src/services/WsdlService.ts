import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import type { Settings } from '../types';

export interface WsdlGenerateResult {
    ok: boolean;
    cancelled?: boolean;
    message: string;
    generatedFiles: string[];
}

/**
 * WSDL → Java 클라이언트 소스 생성 서비스.
 * 설정 화면에서 등록한 JDK(1.8)의 wsimport 도구로 JAX-WS 클라이언트 소스를 생성한다.
 * 생성 소스는 UTF-8이며, WSDL이 src/java 하위에 있으면 해당 경로로 패키지를 정해
 * WSDL과 동일한 폴더에 .java 파일을 생성한다.
 */
export class WsdlService {
    private static readonly SOURCE_ROOT_MARKER = '/src/java/';

    constructor(
        private readonly log: vscode.OutputChannel,
        private readonly settings: Settings,
    ) {}

    /**
     * WSDL 경로가 src/java 하위이면 폴더 구조로부터 자바 패키지명을 유도한다.
     * 예) .../src/java/com/shi/ext/ws/a.wsdl → com.shi.ext.ws
     * src/java 하위가 아니거나 폴더명이 패키지명으로 부적합하면 undefined 반환.
     */
    public static derivePackageFromPath(wsdlPath: string): string | undefined {
        const normalized = wsdlPath.replace(/\\/g, '/');
        const idx = normalized.lastIndexOf(WsdlService.SOURCE_ROOT_MARKER);
        if (idx === -1) return undefined;
        const relDir = path.posix.dirname(normalized.slice(idx + WsdlService.SOURCE_ROOT_MARKER.length));
        if (!relDir || relDir === '.') return undefined;
        const segments = relDir.split('/');
        if (!segments.every(s => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s))) return undefined;
        return segments.join('.');
    }

    /**
     * wsimport를 실행해 WSDL과 동일한 폴더에 Java 소스를 생성한다.
     * @param confirmOverwrite 기존 파일 덮어쓰기 확인 콜백 (기본: VS Code 모달 다이얼로그)
     */
    public async generateJava(
        wsdlPath: string,
        confirmOverwrite?: (files: string[]) => Promise<boolean>
    ): Promise<WsdlGenerateResult> {
        if (!fs.existsSync(wsdlPath)) {
            return { ok: false, message: `WSDL 파일을 찾을 수 없습니다: ${wsdlPath}`, generatedFiles: [] };
        }
        if (!this.settings.jdkPath) {
            return { ok: false, message: 'JDK 경로가 설정되지 않았습니다. XPlatform 설정 화면에서 JDK 경로를 등록해주세요.', generatedFiles: [] };
        }
        const wsimportBin = process.platform === 'win32' ? 'wsimport.exe' : 'wsimport';
        const wsimportPath = path.join(this.settings.jdkPath, 'bin', wsimportBin);
        if (!fs.existsSync(wsimportPath)) {
            return { ok: false, message: `wsimport 도구를 찾을 수 없습니다: ${wsimportPath} (JDK 1.8 필요)`, generatedFiles: [] };
        }

        const wsdlDir = path.dirname(wsdlPath);
        const packageName = WsdlService.derivePackageFromPath(wsdlPath);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsdl-java-'));

        try {
            // -keep -Xnocompile: 컴파일 없이 .java 소스만 생성 / -encoding UTF-8: 생성 소스 인코딩
            // -wsdllocation: 생성된 Service 클래스가 런타임에 클래스패스의 동일 폴더에서 WSDL을 찾도록 상대경로 지정
            const args = [
                '-keep', '-Xnocompile',
                '-encoding', 'UTF-8',
                '-extension',
                '-wsdllocation', path.basename(wsdlPath),
            ];
            if (packageName) args.push('-p', packageName);
            args.push('-s', tmpDir, wsdlPath);

            this.log.appendLine(`[WSDL] wsimport 실행: ${wsimportPath} ${args.join(' ')}`);
            const exitCode = await this.runWsimport(wsimportPath, args);
            if (exitCode !== 0) {
                return { ok: false, message: `wsimport 실행 실패 (종료코드 ${exitCode}). 출력 채널 로그를 확인해주세요.`, generatedFiles: [] };
            }

            const generated = this.collectJavaFiles(tmpDir);
            if (generated.length === 0) {
                return { ok: false, message: 'wsimport가 생성한 Java 파일이 없습니다. 출력 채널 로그를 확인해주세요.', generatedFiles: [] };
            }

            // 패키지를 경로에서 유도한 경우: WSDL과 동일한 폴더에 평면 복사
            // 유도하지 못한 경우: targetNamespace 기반 패키지 폴더 구조를 WSDL 폴더 하위에 복사
            const copyPlan = generated.map(absSrc => {
                const rel = path.relative(tmpDir, absSrc);
                const target = packageName
                    ? path.join(wsdlDir, path.basename(absSrc))
                    : path.join(wsdlDir, rel);
                return { src: absSrc, target };
            });

            const conflicts = copyPlan.filter(p => fs.existsSync(p.target)).map(p => p.target);
            if (conflicts.length > 0) {
                const confirm = confirmOverwrite ?? (async (files: string[]) => {
                    const pick = await vscode.window.showWarningMessage(
                        `기존 파일 ${files.length}개를 덮어씁니다. 계속하시겠습니까?`,
                        { modal: true, detail: files.map(f => path.basename(f)).join('\n') },
                        '덮어쓰기'
                    );
                    return pick === '덮어쓰기';
                });
                if (!(await confirm(conflicts))) {
                    return { ok: false, cancelled: true, message: '', generatedFiles: [] };
                }
            }

            for (const plan of copyPlan) {
                fs.mkdirSync(path.dirname(plan.target), { recursive: true });
                fs.copyFileSync(plan.src, plan.target);
                this.log.appendLine(`[WSDL] 생성: ${plan.target}`);
            }

            const fileNames = copyPlan.map(p => path.relative(wsdlDir, p.target));
            return {
                ok: true,
                message: `WSDL → Java 생성 완료: ${fileNames.length}개 파일 (${path.basename(wsdlPath)})`,
                generatedFiles: fileNames,
            };
        } catch (err) {
            const msg = (err as Error).message;
            this.log.appendLine(`[WSDL] 생성 실패: ${msg}`);
            return { ok: false, message: `WSDL → Java 생성 실패: ${msg}`, generatedFiles: [] };
        } finally {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch {
                // 임시 폴더 정리 실패는 무시
            }
        }
    }

    private runWsimport(wsimportPath: string, args: string[]): Promise<number> {
        return new Promise((resolve, reject) => {
            const proc = spawn(wsimportPath, args, { cwd: path.dirname(wsimportPath) });
            proc.stdout?.on('data', (data: Buffer) => this.appendProcessOutput(data));
            proc.stderr?.on('data', (data: Buffer) => this.appendProcessOutput(data));
            proc.on('error', (err) => reject(err));
            proc.on('close', (code) => resolve(code ?? -1));
        });
    }

    private appendProcessOutput(data: Buffer): void {
        const text = data.toString().trim();
        if (text) this.log.appendLine(`[wsimport] ${text}`);
    }

    /** 디렉토리 하위의 모든 .java 파일 절대경로 수집 */
    private collectJavaFiles(dir: string): string[] {
        const result: string[] = [];
        const walk = (current: string) => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.isFile() && entry.name.endsWith('.java')) result.push(full);
            }
        };
        walk(dir);
        return result;
    }
}
