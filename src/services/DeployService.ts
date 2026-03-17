import * as vscode from 'vscode';
import { ChangedFiles, DeployFileList, Settings, TomcatState } from '../types';
import path from 'path';
import fs from 'fs';
import type { GradleService } from './GradleService';
import type { TomcatService } from './TomcatService';
import { AnalyzeReferenceChain } from './AnalyzeReferenceChain';

export class DeployService {
    private _log: vscode.OutputChannel;
    private _settings: Settings;
    private _deployFileList: DeployFileList;
    private _changedFiles: ChangedFiles;
    private _fileWatchers: vscode.FileSystemWatcher[];
    private _onDeployListChanged?: (uri: vscode.Uri) => void;
    private _tomcatState: TomcatState;
    private _gradleService: GradleService;
    private _tomcatService: TomcatService;
    /** 자동 탐지로 배포 목록에 추가된 Java 파일 (전체 경로). 재분석 시 스킵용 */
    private _autoDetectedJava: Set<string> = new Set();

    constructor(log: vscode.OutputChannel, settings: Settings, deployFileList: DeployFileList, changedFiles: ChangedFiles, fileWatchers: vscode.FileSystemWatcher[], tomcatState: TomcatState, gradleService: GradleService, tomcatService: TomcatService) {
        this._log = log;
        this._settings = settings;
        this._deployFileList = deployFileList;
        this._changedFiles = changedFiles;
        this._fileWatchers = fileWatchers;
        this._tomcatState = tomcatState;
        this._gradleService = gradleService;
        this._tomcatService = tomcatService;
    }

    // 데코레이션 프로바이더 업데이트를 위한 콜백함수 등록
    public setOnDeployListChanged(onDeployListChanged: (uri: vscode.Uri) => void) {
        this._onDeployListChanged = onDeployListChanged;
    }

    // 배포목록관리 팝업에서 파일검색 기능
    public async searchDeployFiles(keyword: string): Promise<string[]> {
        const pattern = new vscode.RelativePattern(this._settings.projectRoot, `src/{java,query}/**/*${keyword}*.*`);
        const uris = await vscode.workspace.findFiles(pattern, '**/*Config.java', 50); // 두번째 인자는 제외파일, 세번째 인자는 최대 검색 건수
        const result = uris.map(u => u.fsPath.replace(/\\/g, '/'));
        const currentJavaFiles = this._deployFileList.java;
        const currentQueryFiles = this._deployFileList.query;
        const filtered = result.filter(r => !currentJavaFiles.includes(r) && !currentQueryFiles.includes(r));
        return filtered;
    }

    // 배포목록관리 팝업에서 배포대상 목록 업데이트 핸들러. autoDetectedAdded: 자동 탐지로 이번에 추가된 파일 목록(있으면 해당 목록을 자동탐지 완료로 기록 후 저장)
    public updateDeployList(deployFileList: DeployFileList, targetFile: string, fileType: string, changeType: string, autoDetectedAdded?: string[]): void {
        if (this._tomcatState.running) {
            vscode.window.showWarningMessage('톰캣 실행 중에는 배포대상에 추가/제거할 수 없습니다.');
            return;
        }
        this._deployFileList.java = deployFileList.java;
        this._deployFileList.query = deployFileList.query;
        this._onDeployListChanged?.(vscode.Uri.file(targetFile));
        if (autoDetectedAdded && autoDetectedAdded.length > 0) {
            this.saveDeploySettings(autoDetectedAdded);
        } else {
            this.saveDeploySettings();
        }
    }

    // 소스 트리 또는 에디터에서 우클릭 하여 배포대상 추가 핸들러
    public addDeployListFromEditor(filePath: string): void {
        if (this._tomcatState.running) {
            vscode.window.showWarningMessage('톰캣 실행 중에는 배포대상에 추가/제거할 수 없습니다.');
            return;
        }
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (normalizedPath.includes('/src/java/')) {
            this.toggleInList(this._deployFileList.java, normalizedPath, 'java');
        } else if (normalizedPath.includes('/src/query/')) {
            this.toggleInList(this._deployFileList.query, normalizedPath, 'query');
        }
        this._onDeployListChanged?.(vscode.Uri.file(normalizedPath));
    }

    // 배포대상 목록에서 추가/제거 토글 기능
    private toggleInList(list: string[], normalizedPath: string, category: string): void {
        if (!list.includes(normalizedPath)) {
            list.push(normalizedPath); // 배포대상에 추가
        } else {
            const index = list.indexOf(normalizedPath);
            if (index !== -1) {
                list.splice(index, 1); // 배포대상에서 제거
            }
        }
        this.saveDeploySettings();
    }

    // 배포 설정 파일 경로
    private _getDeploySettingsPath(): string {
        return path.join(this._settings.projectRoot, '.vscode', 'shi-deploy.json');
    }

    // 배포 설정 저장. mergeAutoDetected: 이번에 자동 탐지로 추가된 파일 전체 경로 배열(있으면 autoDetectedJava에 병합 후 저장)
    public saveDeploySettings(mergeAutoDetected?: string[]): void {
        try {
            if (mergeAutoDetected && mergeAutoDetected.length > 0) {
                mergeAutoDetected.forEach(p => this._autoDetectedJava.add(p.replace(/\\/g, '/')));
            }
            const settingsPath = this._getDeploySettingsPath();
            const dir = path.dirname(settingsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const srcPrefix = `${this._settings.projectRoot.replace(/\\/g, '/')}/src/`;
            const stripPrefix = (list: string[]) => list.map(p => p.replace(srcPrefix, ''));
            const data = {
                deployFileList: {
                    java: stripPrefix(this._deployFileList.java),
                    query: stripPrefix(this._deployFileList.query),
                },
                profile: this._tomcatState.profile,
                isBatch: this._tomcatState.isBatch,
                deployMode: this._tomcatState.deployMode,
                autoDetectedJava: stripPrefix(Array.from(this._autoDetectedJava)),
            };
            fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4), 'utf8');
        } catch {
            // 저장 실패 시 무시
        }
    }

    // 배포 설정 로드
    public loadDeploySettings(): void {
        try {
            const settingsPath = this._getDeploySettingsPath();
            if (!fs.existsSync(settingsPath)) return;
            const raw = fs.readFileSync(settingsPath, 'utf8');
            const data = JSON.parse(raw);
            const srcPrefix = `${this._settings.projectRoot.replace(/\\/g, '/')}/src/`;
            const addPrefix = (list: string[]) => list.map((p: string) => `${srcPrefix}${p}`);
            if (data.deployFileList) {
                if (Array.isArray(data.deployFileList.java)) this._deployFileList.java = addPrefix(data.deployFileList.java);
                if (Array.isArray(data.deployFileList.query)) this._deployFileList.query = addPrefix(data.deployFileList.query);
            }
            if (Array.isArray(data.autoDetectedJava)) {
                this._autoDetectedJava = new Set(addPrefix(data.autoDetectedJava));
            } else {
                this._autoDetectedJava = new Set();
            }
            if (typeof data.profile === 'string') this._tomcatState.profile = data.profile;
            if (typeof data.isBatch === 'boolean') this._tomcatState.isBatch = data.isBatch;
            if (data.deployMode === 'default' || data.deployMode === 'selected') this._tomcatState.deployMode = data.deployMode;
        } catch {
            // 로드 실패 시 무시
        }
    }

    // 파일 변경 감지 시작 (Tomcat 기동/디버그 시 호출)
    public startFileWatcher(_postMessage: (message: unknown) => void): void {
        this.stopFileWatcher(); // 기존 watcher 정리
        this._changedFiles.java.length = 0, this._changedFiles.query.length = 0; // 변경 목록 초기화

        const projectRoot = this._settings.projectRoot;
        const dirs = [
            { pattern: new vscode.RelativePattern(projectRoot, 'src/java/**/*'), category: 'java' as const },
            { pattern: new vscode.RelativePattern(projectRoot, 'src/query/**/*'), category: 'query' as const },
            ...(!this._tomcatService.isDeveloperMode
                ? [{ pattern: new vscode.RelativePattern(projectRoot, 'src/webapp/**/*'), category: 'static' as const }]
                : []),
        ];

        for (const { pattern, category } of dirs) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange((uri: vscode.Uri) => this._fileChangedHandler(uri, _postMessage, category));
            watcher.onDidCreate((uri: vscode.Uri) => this._fileChangedHandler(uri, _postMessage, category));
            this._fileWatchers.push(watcher);
        }
        if (this._tomcatService.isDeveloperMode) {
            this._log.appendLine('[FileWatcher] 파일 변경 감지 시작 (src/java, src/query)');
        } else {
            this._log.appendLine('[FileWatcher] 파일 변경 감지 시작 (src/java, src/query, src/webapp)');
        }
    }

    // 파일 변경 핸들러
    private _fileChangedHandler(uri: vscode.Uri, _postMessage: (message: unknown) => void, category: string): void {
        const normalizedPath = uri.fsPath.replace(/\\/g, '/');
        // ~~~.git으로 끝나는 파일은 기능에서 제외
        if (normalizedPath.endsWith('.git')) return;

        // 정적 파일의 경우, 파일 변경 시 리스트화 하지 않고 즉시 복사
        if (category === 'static') {
            const relativePath = normalizedPath.replace(`${this._settings.projectRoot.replace(/\\/g, '/')}/src/webapp/`, '');
            const destPath = path.join(this._tomcatState.deployPath, relativePath);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            if (fs.existsSync(normalizedPath)) {
                fs.copyFileSync(normalizedPath, destPath);
                return;
            }
        }

        // 배포 모드가 선택 모드인 경우에는 java 또는 query 파일은 배포대상인 경우에만 변경목록에 추가
        if (this._tomcatState.deployMode === 'selected') {
            if (category === 'java') {
                if (!this._deployFileList.java.includes(normalizedPath)) return;
            }
            else if (category === 'query') {
                if (!this._deployFileList.query.includes(normalizedPath)) return;
            }
        }
        // 변경 목록에 추가하고 ui 업데이트
        if (!this._changedFiles[category as keyof ChangedFiles].includes(normalizedPath)) {
            this._changedFiles[category as keyof ChangedFiles].push(normalizedPath);
            _postMessage({ type: 'changedFilesUpdate', changedFiles: this._changedFiles });
        }
    }

    // 파일 변경 감지 중지 (Tomcat 중지 시 호출)
    public stopFileWatcher(): void {
        for (const watcher of this._fileWatchers) {
            watcher.dispose();
        }
        this._fileWatchers = [];
    }

    // tomcat 기동 중 변경된 파일을 로컬 서버에 적용
    public applyChangedFiles(): void {
        const hasJavaChanges = this._changedFiles.java.length > 0;
        this._log.show(true);
        this._log.appendLine('[배포 적용] 변경 파일 Tomcat 반영 시작...');

        if (hasJavaChanges) {
            this._log.appendLine('[배포 적용] Java 파일 변경 있음. gradle classes 실행 후 복사합니다.');
            this._gradleService.buildClassesWithCallback((success) => {
                if (success) {
                    this._log.appendLine('[배포 적용] gradle classes 성공. 복사 단계 진행.');
                } else {
                    this._log.appendLine('[배포 적용] gradle classes 실패. 복사 단계는 그대로 진행합니다.');
                }
                this._doCopyAndClear();
            });
        } else {
            this._doCopyAndClear();
        }
    }

    // 복사 수행 후 변경 목록 초기화 (성공/실패와 관계없이 호출)
    private _doCopyAndClear(): void {
        const classesPath = path.join(this._tomcatState.deployPath, 'WEB-INF', 'classes');

        // 1. Java .class 파일 복사 (inner class 포함)
        for (const javaFile of this._changedFiles.java) {
            const normalizedJavaFile = javaFile.replace(/\\/g, '/');
            const relativePath = normalizedJavaFile.replace(`${this._settings.projectRoot.replace(/\\/g, '/')}/src/java/`, '');
            const baseClassName = relativePath.replace(/\.java$/, '');
            const classDir = path.join(this._settings.projectRoot, 'target', 'classes', path.dirname(baseClassName));
            const baseName = path.basename(baseClassName);
            if (fs.existsSync(classDir)) {
                const files = fs.readdirSync(classDir);
                const matchingFiles = files.filter(f => f === `${baseName}.class` || f.startsWith(`${baseName}$`));
                for (const classFile of matchingFiles) {
                    const srcClassPath = path.join(classDir, classFile);
                    const destClassPath = path.join(classesPath, path.dirname(baseClassName), classFile);
                    const destDir = path.dirname(destClassPath);
                    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                    fs.copyFileSync(srcClassPath, destClassPath);
                    this._log.appendLine(`  [Java] ${path.dirname(baseClassName)}/${classFile} 복사됨`);
                }
            } else {
                this._log.appendLine(`  [경고] class 디렉터리 없음: ${classDir} 복사 건너뜀`);
            }
        }

        // 2. Query 파일 복사
        for (const queryFile of this._changedFiles.query) {
            const normalizedQueryFile = queryFile.replace(/\\/g, '/');
            const relativePath = normalizedQueryFile.replace(`${this._settings.projectRoot.replace(/\\/g, '/')}/src/query/`, '');
            const destPath = path.join(classesPath, relativePath);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            if (fs.existsSync(queryFile)) {
                fs.copyFileSync(queryFile, destPath);
                this._log.appendLine(`  [Query] ${relativePath} 복사됨`);
            }
        }

        this._log.appendLine('[배포 적용] 변경 파일 Tomcat 반영 완료.');
        this._changedFiles.java.length = 0;
        this._changedFiles.query.length = 0;
    }

    // 배포목록관리 팝업에서 참조 파일 자동 추가 기능
    async analyzeReferenceChain(javaFiles: string[]): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '참조 분석',
                cancellable: false,
            },
            async (progress) => {
                this.loadDeploySettings();
                const normalizedInput = javaFiles.map(f => f.replace(/\\/g, '/'));
                const toProcess = normalizedInput.filter(f => !this._autoDetectedJava.has(f));
                if (toProcess.length === 0) {
                    return;
                }
                const analyzer = new AnalyzeReferenceChain();
                const visited = new Set<string>(toProcess);
                const queue: string[] = [...toProcess];
                const added: string[] = [];
                // 1단계: Java 배포 목록에서 재귀적으로 참조 클래스를 탐색해 배포 목록에 추가
                while (queue.length > 0) {
                    const filePath = queue.shift()!;
                    progress.report({ message: `1단계: 참조 탐색 중 — ${path.basename(filePath)}` });
                    const fileUri = vscode.Uri.file(filePath);
                    const refs: Set<string> = await analyzer.analyzeOutboundFromFile(fileUri);
                    for (const refPath of refs) {
                        const normalized = refPath.replace(/\\/g, '/');
                        if (this._autoDetectedJava.has(normalized)) continue;
                        if (!visited.has(normalized)) {
                            visited.add(normalized);
                            added.push(normalized);
                            queue.push(normalized);
                        }
                    }
                }
                // 2단계: 새로 발견된 파일을 배포 목록에 일괄 추가
                if (added.length > 0) {
                    progress.report({ message: '2단계: 배포 목록에 추가 중...' });
                    const newJavaList = [...this._deployFileList.java];
                    for (const f of added) {
                        if (!newJavaList.includes(f)) newJavaList.push(f);
                    }
                    const newDeployFileList = { ...this._deployFileList, java: newJavaList };
                    this.updateDeployList(newDeployFileList, '', 'java', 'add', added);
                }
                // 3단계: Java 배포 목록 전체에서 연관 Query 파일을 자동으로 query 배포 목록에 추가
                progress.report({ message: '3단계: Query 연관 파일 추가 중...' });
                const currentJavaList = [...this._deployFileList.java];
                const newQueryList = [...this._deployFileList.query];
                let queryAdded = false;
                for (const javaPath of currentJavaList) {
                    const normalized = javaPath.replace(/\\/g, '/');
                    const javaSegment = '/src/java/';
                    const javaIdx = normalized.indexOf(javaSegment);
                    if (javaIdx === -1) continue;

                    const projectRoot = normalized.substring(0, javaIdx);
                    const packageAndFile = normalized.substring(javaIdx + javaSegment.length);

                    const fileName = path.basename(packageAndFile);
                    const packagePath = path.dirname(packageAndFile);

                    const queryFileName = fileName.replace(/(Service|Controller)\.java$/, 'Query.xml');
                    if (queryFileName === fileName) continue;

                    const queryPath = `${projectRoot}/src/query/${packagePath}/${queryFileName}`;

                    if (!fs.existsSync(queryPath)) continue;
                    if (newQueryList.includes(queryPath)) continue;

                    newQueryList.push(queryPath);
                    queryAdded = true;
                }
                if (queryAdded) {
                    const newDeployFileList = { ...this._deployFileList, query: newQueryList };
                    this.updateDeployList(newDeployFileList, '', 'query', 'add');
                }
            }
        );
    }

    public clearDeployFiles(): void {
        this._deployFileList.java.length = 0;
        this._deployFileList.query.length = 0;
        this.saveDeploySettings();
    }
}