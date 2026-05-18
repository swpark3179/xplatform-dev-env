import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { Settings } from '../types';

export interface GitIgnoreItem {
    path: string;       // 프로젝트 루트 기준 POSIX 상대경로
    sub?: string;       // UI 표시용 부가설명
    recommended?: boolean;
    applied: boolean;   // git 에서 실제 skip-worktree 여부
}

interface PersistedState {
    items: { path: string; sub?: string; recommended?: boolean }[];
}

/**
 * .vscode/local-ignore.json 에 메타데이터(설명/추천 여부)를 저장하고,
 * 실제 무시 여부는 `git update-index --skip-worktree` 로 적용/조회한다.
 */
export class GitIgnoreService {
    private static readonly PERSIST_DIR = '.vscode';
    private static readonly PERSIST_FILE = 'local-ignore.json';

    constructor(
        private readonly log: vscode.OutputChannel,
        private readonly settings: Settings,
    ) {}

    private get projectRoot(): string {
        return this.settings.projectRoot;
    }

    private get persistPath(): string {
        return path.join(this.projectRoot, GitIgnoreService.PERSIST_DIR, GitIgnoreService.PERSIST_FILE);
    }

    /** 절대 또는 임의 구분자 경로를 프로젝트 루트 기준 POSIX 상대경로로 정규화 */
    public toRelativePosix(input: string): string | undefined {
        if (!input || !this.projectRoot) return undefined;
        let rel = path.isAbsolute(input)
            ? path.relative(this.projectRoot, input)
            : input;
        rel = rel.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!rel || rel.startsWith('..')) return undefined;
        return rel;
    }

    /** git ls-files -v 결과에서 skip-worktree (S/s) 표시된 파일 목록 추출 */
    private async listSkipWorktreeFiles(): Promise<string[]> {
        if (!this.projectRoot) return [];
        try {
            const stdout = await this.git(['ls-files', '-v']);
            const lines = stdout.split(/\r?\n/);
            const result: string[] = [];
            for (const line of lines) {
                // 형식: "<tag> <path>"  소문자 s = skip-worktree, S = skip-worktree + assume-unchanged
                if (/^[Ss]\s/.test(line)) {
                    result.push(line.slice(2).trim());
                }
            }
            return result;
        } catch (err) {
            this.log.appendLine(`[GitIgnore] ls-files 실패: ${(err as Error).message}`);
            return [];
        }
    }

    private loadPersisted(): PersistedState {
        try {
            if (fs.existsSync(this.persistPath)) {
                const raw = fs.readFileSync(this.persistPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.items)) return parsed;
            }
        } catch (err) {
            this.log.appendLine(`[GitIgnore] 상태파일 로드 실패: ${(err as Error).message}`);
        }
        return { items: [] };
    }

    private savePersisted(state: PersistedState): void {
        try {
            const dir = path.dirname(this.persistPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.persistPath, JSON.stringify(state, null, 2), 'utf8');
        } catch (err) {
            this.log.appendLine(`[GitIgnore] 상태파일 저장 실패: ${(err as Error).message}`);
        }
    }

    /** 현재 적용된 + 메타로 등록된 항목을 합쳐서 조회 */
    public async list(): Promise<GitIgnoreItem[]> {
        const applied = new Set(await this.listSkipWorktreeFiles());
        const persisted = this.loadPersisted();
        const byPath = new Map<string, GitIgnoreItem>();

        for (const meta of persisted.items) {
            byPath.set(meta.path, {
                path: meta.path,
                sub: meta.sub,
                recommended: meta.recommended,
                applied: applied.has(meta.path),
            });
        }
        for (const p of applied) {
            if (!byPath.has(p)) {
                byPath.set(p, { path: p, applied: true });
            }
        }
        return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
    }

    /** 파일에 skip-worktree 적용. 추적되지 않은 파일은 먼저 인텐트 추가 시도. */
    public async apply(relPath: string): Promise<{ ok: boolean; message?: string }> {
        const normalized = this.toRelativePosix(relPath);
        if (!normalized) return { ok: false, message: '유효하지 않은 경로입니다.' };
        try {
            // 추적 중인지 확인. 미추적이면 skip-worktree 가 동작하지 않음.
            const isTracked = await this.isTracked(normalized);
            if (!isTracked) {
                return { ok: false, message: 'Git 이 추적 중인 파일이 아닙니다. (skip-worktree 는 추적 파일에만 적용 가능)' };
            }
            await this.git(['update-index', '--skip-worktree', '--', normalized]);
            this.updatePersistedEntry(normalized, true);
            return { ok: true };
        } catch (err) {
            const msg = (err as Error).message;
            this.log.appendLine(`[GitIgnore] apply 실패(${normalized}): ${msg}`);
            return { ok: false, message: msg };
        }
    }

    public async release(relPath: string): Promise<{ ok: boolean; message?: string }> {
        const normalized = this.toRelativePosix(relPath);
        if (!normalized) return { ok: false, message: '유효하지 않은 경로입니다.' };
        try {
            await this.git(['update-index', '--no-skip-worktree', '--', normalized]);
            this.updatePersistedEntry(normalized, false);
            return { ok: true };
        } catch (err) {
            const msg = (err as Error).message;
            this.log.appendLine(`[GitIgnore] release 실패(${normalized}): ${msg}`);
            return { ok: false, message: msg };
        }
    }

    /** Explorer 우클릭 토글: 현재 적용 상태에 따라 apply/release 결정. 결과 적용 후 상태 반환. */
    public async toggle(absOrRel: string): Promise<{ ok: boolean; applied: boolean; path: string; message?: string }> {
        const normalized = this.toRelativePosix(absOrRel);
        if (!normalized) return { ok: false, applied: false, path: absOrRel, message: '유효하지 않은 경로입니다.' };
        const applied = new Set(await this.listSkipWorktreeFiles());
        if (applied.has(normalized)) {
            const r = await this.release(normalized);
            return { ok: r.ok, applied: !r.ok, path: normalized, message: r.message };
        } else {
            const r = await this.apply(normalized);
            return { ok: r.ok, applied: r.ok, path: normalized, message: r.message };
        }
    }

    /** 작업 트리와 인덱스 상태를 다시 동기화 (적용된 파일 목록을 영속 상태에 반영) */
    public async sync(): Promise<GitIgnoreItem[]> {
        const applied = await this.listSkipWorktreeFiles();
        const persisted = this.loadPersisted();
        const known = new Set(persisted.items.map(i => i.path));
        for (const p of applied) {
            if (!known.has(p)) persisted.items.push({ path: p });
        }
        this.savePersisted(persisted);
        return this.list();
    }

    private updatePersistedEntry(relPath: string, _appliedNow: boolean): void {
        const persisted = this.loadPersisted();
        const idx = persisted.items.findIndex(i => i.path === relPath);
        if (idx === -1) persisted.items.push({ path: relPath });
        this.savePersisted(persisted);
    }

    private async isTracked(relPath: string): Promise<boolean> {
        try {
            const stdout = await this.git(['ls-files', '--', relPath]);
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    private git(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', args, { cwd: this.projectRoot, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    const msg = stderr?.toString().trim() || err.message;
                    reject(new Error(msg));
                    return;
                }
                resolve(stdout.toString());
            });
        });
    }
}
