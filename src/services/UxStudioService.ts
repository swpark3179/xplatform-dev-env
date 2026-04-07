import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { UxServiceEntry, UxStudioEnvConfig } from '../types';

// 기본 제외 폴더 목록
const BASE_PREFIX_IDS = ['lib', 'Images', 'CSS', 'WORK', 'comm', 'composite', 'frame', 'frame_sgips', 'cmc'];

// url 자동보정 치환 대상
const URL_CORRECT_FROM = 'localhost:7001/ep/';
const URL_CORRECT_TO = '60.101.107.57:8002/ep/';

export class UxStudioService {
    private _log: vscode.OutputChannel;
    private _projectRoot: string;
    private _myChangesWatcher?: vscode.FileSystemWatcher;

    // my-changes 파일 경로 매핑: { destAbsPath: srcAbsPath }
    private _fileMap: Record<string, string> = {};

    constructor(log: vscode.OutputChannel, projectRoot: string) {
        this._log = log;
        this._projectRoot = projectRoot;
    }

    /** 프로젝트 루트 갱신 (설정 변경 시 호출) */
    public updateProjectRoot(projectRoot: string): void {
        this._projectRoot = projectRoot;
    }

    // ============================================================
    // 개발자 모드 감지
    // ============================================================

    /**
     * Windows 개발자 모드(심볼릭 링크 생성 가능 여부) 감지.
     * 임시 심볼릭 링크 생성을 시도하여 성공 여부로 판단한다.
     */
    public checkDevMode(): boolean {
        const uiEnvDir = this._getUiEnvDir();
        if (!fs.existsSync(uiEnvDir)) {
            try { fs.mkdirSync(uiEnvDir, { recursive: true }); } catch { return false; }
        }
        const testLink = path.join(uiEnvDir, '.devmode_test_symlink');
        const testTarget = uiEnvDir;
        try {
            if (fs.existsSync(testLink)) fs.unlinkSync(testLink);
            fs.symlinkSync(testTarget, testLink, 'junction');
            fs.unlinkSync(testLink);
            return true;
        } catch {
            try { if (fs.existsSync(testLink)) fs.unlinkSync(testLink); } catch { /* ignore */ }
            return false;
        }
    }

    // ============================================================
    // 설정 상태 확인
    // ============================================================

    /** .vscode/ui-env/env.json 존재 여부로 설정 상태 판단 */
    public checkSetupStatus(): 'configured' | 'new' {
        const envPath = path.join(this._getUiEnvDir(), 'env.json');
        return fs.existsSync(envPath) ? 'configured' : 'new';
    }

    /** .vscode/ui-env/env.json 로드 */
    public loadEnvConfig(): UxStudioEnvConfig | null {
        const envPath = path.join(this._getUiEnvDir(), 'env.json');
        if (!fs.existsSync(envPath)) return null;
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            return JSON.parse(content) as UxStudioEnvConfig;
        } catch (e) {
            this._log.appendLine(`[UxStudio] env.json 읽기 실패: ${e}`);
            return null;
        }
    }

    // ============================================================
    // XML 파싱
    // ============================================================

    /** src/webapp/ui/default_typedef.xml 파싱 → Service 엔트리 목록 반환 */
    public parseDefaultTypedef(): UxServiceEntry[] {
        const xmlPath = path.join(this._projectRoot, 'src', 'webapp', 'ui', 'default_typedef.xml');
        if (!fs.existsSync(xmlPath)) {
            this._log.appendLine(`[UxStudio] default_typedef.xml 없음: ${xmlPath}`);
            return [];
        }
        try {
            const content = fs.readFileSync(xmlPath, 'utf8');
            return this._parseServiceTags(content);
        } catch (e) {
            this._log.appendLine(`[UxStudio] default_typedef.xml 파싱 실패: ${e}`);
            return [];
        }
    }

    /** XML 문자열에서 Service 태그를 파싱하여 엔트리 목록 반환 */
    private _parseServiceTags(xml: string): UxServiceEntry[] {
        const entries: UxServiceEntry[] = [];
        // <Service ... /> 형태의 태그를 정규식으로 수집
        const serviceTagRegex = /<Service\s([^/]*?)\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = serviceTagRegex.exec(xml)) !== null) {
            const attrs = match[1];
            const entry: UxServiceEntry = {
                prefixid: this._extractAttr(attrs, 'prefixid'),
                type: this._extractAttr(attrs, 'type'),
                url: this._extractAttr(attrs, 'url'),
                version: this._extractAttr(attrs, 'version'),
                communicationversion: this._extractAttr(attrs, 'communicationversion'),
                cachelevel: this._extractAttr(attrs, 'cachelevel'),
            };
            entries.push(entry);
        }
        return entries;
    }

    private _extractAttr(attrs: string, name: string): string {
        const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
        const m = attrs.match(regex);
        return m ? m[1] : '';
    }

    // ============================================================
    // 설정 적용 (3단계)
    // ============================================================

    /** 3단계: 설정 적용 */
    public async applySettings(config: UxStudioEnvConfig, allServices: UxServiceEntry[]): Promise<void> {
        const uiEnvDir = this._getUiEnvDir();
        const uiSrcDir = path.join(this._projectRoot, 'src', 'webapp', 'ui');

        // 1. ui-env/ 내 XPLATFORM_Client_License.xml 제외 모든 파일·폴더 삭제
        this._cleanUiEnvDir(uiEnvDir);

        // 2. src/webapp/ui/ 내 xprj, xadl은 실제 파일 복사, xtheme, globalvars*.xml은 심볼릭 링크 생성
        await this._createFilesAndSymlinks(uiSrcDir, uiEnvDir);

        if (config.mode === 'default') {
            // 기본모드인 경우, xprj 및 xadl 파일마다 내용을 수정하여 default_typedef.xml 문자열을 절대 경로로 치환
            const destXmlAbsPath = path.join(uiSrcDir, 'default_typedef.xml').replace(/\\/g, '/');
            const files = fs.readdirSync(uiEnvDir);
            for (const file of files) {
                if (file.endsWith('.xprj') || file.endsWith('.xadl')) {
                    const filePath = path.join(uiEnvDir, file);
                    let content = fs.readFileSync(filePath, 'utf8');
                    content = content.replace(/default_typedef\.xml/g, destXmlAbsPath);
                    fs.writeFileSync(filePath, content, 'utf8');
                }
            }
        } else {
            // 3. 선택모드인 경우 default_typedef.xml 복사
            const srcXml = path.join(uiSrcDir, 'default_typedef.xml');
            const destXml = path.join(uiEnvDir, 'default_typedef.xml');
            fs.copyFileSync(srcXml, destXml);

            // 4. 복사된 xml 수정
            this._modifyTypedefXml(destXml, config, allServices);
        }

        // 5. env.json 저장
        fs.writeFileSync(path.join(uiEnvDir, 'env.json'), JSON.stringify(config, null, 2), 'utf8');

        this._log.appendLine('[UxStudio] 설정 적용 완료');
    }

    private _cleanUiEnvDir(uiEnvDir: string): void {
        if (!fs.existsSync(uiEnvDir)) {
            fs.mkdirSync(uiEnvDir, { recursive: true });
            return;
        }
        const entries = fs.readdirSync(uiEnvDir);
        for (const entry of entries) {
            if (entry === 'XPLATFORM_Client_License.xml') continue;
            const fullPath = path.join(uiEnvDir, entry);
            try {
                const stat = fs.lstatSync(fullPath);
                if (stat.isDirectory() && !stat.isSymbolicLink()) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(fullPath);
                }
            } catch (e) {
                this._log.appendLine(`[UxStudio] 삭제 실패: ${fullPath} — ${e}`);
            }
        }
    }

    private async _createFilesAndSymlinks(srcDir: string, destDir: string): Promise<void> {
        if (!fs.existsSync(srcDir)) return;

        const copyPatterns = [/\.xprj$/, /\.xadl$/];
        const symlinkPatterns = [/\.xtheme$/, /^globalvars.*\.xml$/];
        const files = fs.readdirSync(srcDir);

        const operations = files.map(async (file) => {
            const isCopy = copyPatterns.some(p => p.test(file));
            const isSymlink = symlinkPatterns.some(p => p.test(file));

            if (!isCopy && !isSymlink) return;

            const srcFile = path.join(srcDir, file);
            const destFile = path.join(destDir, file);

            try {
                if (fs.existsSync(destFile)) {
                    await fs.promises.unlink(destFile);
                }

                if (isCopy) {
                    await fs.promises.copyFile(srcFile, destFile);
                } else if (isSymlink) {
                    await fs.promises.symlink(srcFile, destFile, 'file');
                }
            } catch (e) {
                const action = isCopy ? '파일 복사' : '심볼릭 링크';
                this._log.appendLine(`[UxStudio] ${action} 실패: ${file} — ${e}`);
            }
        });

        await Promise.all(operations);
    }

    private _modifyTypedefXml(xmlPath: string, config: UxStudioEnvConfig, allServices: UxServiceEntry[]): void {
        let content = fs.readFileSync(xmlPath, 'utf8');

        // url이 ./로 시작하는 Service 태그들을 찾음 (#서비스#)
        const uiDirPath = path.join(this._projectRoot, 'src', 'webapp', 'ui').replace(/\\/g, '/');

        // 정규식을 사용해 <Service ... url="./..." ... /> 형식의 태그를 찾고 치환함
        const serviceTagRegex = /<Service\s+([^>]*?)url\s*=\s*["'](\.\/[^"']*)["']([^>]*?)\/?>/gi;

        content = content.replace(serviceTagRegex, (fullMatch, beforeUrl, urlValue, afterUrl) => {
            // #서비스# 목록 관리 (삭제 대상을 판단하기 위해)
            const prefixMatch = fullMatch.match(/prefixid\s*=\s*["']([^"']+)["']/i);
            const prefixid = prefixMatch ? prefixMatch[1] : '';

            // url이 ./ 로 시작하는 경우 절대경로로 치환
            // ./ 제외한 나머지 경로
            const relativePath = urlValue.substring(2);
            const absoluteUrl = `${uiDirPath}/${relativePath}`;

            const newTag = `<Service ${beforeUrl}url="${absoluteUrl}"${afterUrl}/>`;

            // 삭제 대상 조건: 커스텀 서비스(기본 폴더가 아님)인데 선택되지 않은 경우
            if (!BASE_PREFIX_IDS.includes(prefixid) && !config.customPrefixIds.includes(prefixid)) {
                return ''; // content에서 제거
            }

            return newTag;
        });

        // url 자동보정
        if (config.urlAutoCorrect) {
            content = content.split(URL_CORRECT_FROM).join(URL_CORRECT_TO);
        }

        fs.writeFileSync(xmlPath, content, 'utf8');
    }

    // ============================================================
    // 설정 초기화
    // ============================================================

    /** 설정 폴더를 비워서 초기화 상태로 되돌림 */
    public resetSetup(): void {
        const uiEnvDir = this._getUiEnvDir();
        try {
            this._cleanUiEnvDir(uiEnvDir);
            this._log.appendLine('[UxStudio] 설정 초기화 완료');
        } catch (e) {
            this._log.appendLine(`[UxStudio] 설정 초기화 실패: ${e}`);
        }
    }

    // ============================================================
    // 커스텀 작업파일 수집 (4단계)
    // ============================================================

    /**
     * src/webapp/ui/ 내에서 제외 폴더를 건너뛰고 xfdl 파일을 재귀 수집.
     * 반환값: 상대경로 배열 (src/webapp/ui/ 기준)
     */
    public searchXfdlFiles(): string[] {
        const uiDir = path.join(this._projectRoot, 'src', 'webapp', 'ui');
        if (!fs.existsSync(uiDir)) return [];
        const results: string[] = [];
        this._collectXfdl(uiDir, uiDir, results);
        return results.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    }

    private _collectXfdl(baseDir: string, currentDir: string, results: string[]): void {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                // 최상위 레벨에서만 제외 폴더 처리
                if (currentDir === baseDir && BASE_PREFIX_IDS.includes(entry.name)) continue;
                this._collectXfdl(baseDir, fullPath, results);
            } else if (entry.isFile() && entry.name.endsWith('.xfdl')) {
                results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
            }
        }
    }

    // ============================================================
    // 커스텀 작업파일 확정 (5단계)
    // ============================================================

    /**
     * 선택된 xfdl 파일을 my-changes/ 로 복사하고 매핑 파일 저장.
     * selectedFiles: src/webapp/ui/ 기준 상대경로 배열
     */
    public async confirmFiles(selectedFiles: string[]): Promise<void> {
        const uiDir = path.join(this._projectRoot, 'src', 'webapp', 'ui');
        const myChangesDir = path.join(this._getUiEnvDir(), 'my-changes');
        const newFileMap: Record<string, string> = {};

        const copyPromises: Promise<void>[] = [];

        for (const relPath of selectedFiles) {
            const srcAbs = path.join(uiDir, relPath);
            try { await fs.promises.access(srcAbs); } catch { continue; }

            // 마지막 상위 경로 하나 제거한 대상 경로
            const parts = relPath.split('/');
            // 예: cm/cme/cmes/CMES0006.xfdl → cm/cme/CMES0006.xfdl
            const destRel = parts.length >= 2
                ? [...parts.slice(0, -2), parts[parts.length - 1]].join('/')
                : parts[parts.length - 1];

            const destAbs = path.join(myChangesDir, destRel);

            newFileMap[destAbs.replace(/\\/g, '/')] = srcAbs.replace(/\\/g, '/');

            copyPromises.push((async () => {
                await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
                await fs.promises.copyFile(srcAbs, destAbs);
            })());
        }

        await Promise.all(copyPromises);

        // 매핑 저장
        const mapPath = path.join(this._getUiEnvDir(), 'my-changes-map.json');
        // 기존 매핑과 병합
        let existingMap: Record<string, string> = {};
        if (fs.existsSync(mapPath)) {
            try { existingMap = JSON.parse(await fs.promises.readFile(mapPath, 'utf8')); } catch { /* ignore */ }
        }
        const merged = { ...existingMap, ...newFileMap };
        await fs.promises.writeFile(mapPath, JSON.stringify(merged, null, 2), 'utf8');
        this._fileMap = merged;

        // default_typedef.xml 에 My-Changes Service 태그 추가
        await this._addMyChangesServiceTagAsync();

        this._log.appendLine(`[UxStudio] 작업파일 확정: ${selectedFiles.length}개`);
    }

    private async _addMyChangesServiceTagAsync(): Promise<void> {
        const xmlPath = path.join(this._getUiEnvDir(), 'default_typedef.xml');
        if (!fs.existsSync(xmlPath)) return;
        let content = await fs.promises.readFile(xmlPath, 'utf8');
        // 이미 My-Changes가 있으면 추가 안 함
        if (content.includes('prefixid="My-Changes"')) return;
        const tag = `<Service prefixid="My-Changes" type="remote" url="./my-changes/" version="1" communicationversion="1" cachelevel="0"/>`;
        content = content.replace(/<\/Services>/i, `        ${tag}\n    </Services>`);
        await fs.promises.writeFile(xmlPath, content, 'utf8');
    }

    // ============================================================
    // xprj 파일 목록 (6단계)
    // ============================================================

    public getXprjFiles(): string[] {
        const uiEnvDir = this._getUiEnvDir();
        if (!fs.existsSync(uiEnvDir)) return [];
        return fs.readdirSync(uiEnvDir)
            .filter(f => f.endsWith('.xprj'))
            .map(f => path.join(uiEnvDir, f).replace(/\\/g, '/'));
    }

    /** xprj 파일을 OS 기본 연결 프로그램으로 실행 */
    public launchXprj(filePath: string): void {
        vscode.env.openExternal(vscode.Uri.file(filePath)).then((success) => {
            if (!success) {
                this._log.appendLine(`[UxStudio] xprj 실행 실패: ${filePath}`);
            }
        });
    }

    // ============================================================
    // my-changes 파일 감시 (5단계)
    // ============================================================

    public startMyChangesWatcher(): void {
        if (this._myChangesWatcher) return; // 이미 감시 중

        // 매핑 파일 로드
        this._loadFileMap();

        const pattern = new vscode.RelativePattern(
            path.join(this._getUiEnvDir(), 'my-changes'),
            '**/*'
        );
        this._myChangesWatcher = vscode.workspace.createFileSystemWatcher(pattern, true, false, true);
        this._myChangesWatcher.onDidChange(uri => {
            this._handleMyChangesFileChanged(uri.fsPath);
        });
        this._log.appendLine('[UxStudio] my-changes 파일 감시 시작');
    }

    public stopMyChangesWatcher(): void {
        if (this._myChangesWatcher) {
            this._myChangesWatcher.dispose();
            this._myChangesWatcher = undefined;
            this._log.appendLine('[UxStudio] my-changes 파일 감시 중지');
        }
    }

    private _handleMyChangesFileChanged(destPath: string): void {
        const normalizedDest = destPath.replace(/\\/g, '/');
        const srcPath = this._fileMap[normalizedDest];
        if (!srcPath) {
            this._log.appendLine(`[UxStudio] 매핑 없음: ${normalizedDest}`);
            return;
        }
        try {
            fs.copyFileSync(destPath, srcPath);
            this._log.appendLine(`[UxStudio] 변경 반영: ${path.basename(destPath)} → ${srcPath}`);
        } catch (e) {
            this._log.appendLine(`[UxStudio] 변경 반영 실패: ${e}`);
        }
    }

    private _loadFileMap(): void {
        const mapPath = path.join(this._getUiEnvDir(), 'my-changes-map.json');
        if (!fs.existsSync(mapPath)) return;
        try {
            this._fileMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        } catch { /* ignore */ }
    }

    // ============================================================
    // 유틸
    // ============================================================

    private _getUiEnvDir(): string {
        return path.join(this._projectRoot, '.vscode', 'ui-env');
    }

    /** 커스텀 체크박스 대상 Service 목록 반환 (기본 제외, url이 ./로 시작하는 것) */
    public getCustomServices(allServices: UxServiceEntry[]): UxServiceEntry[] {
        const excludeIds = new Set(BASE_PREFIX_IDS);
        return allServices.filter(s => !excludeIds.has(s.prefixid) && s.url.startsWith('./'));
    }
}
