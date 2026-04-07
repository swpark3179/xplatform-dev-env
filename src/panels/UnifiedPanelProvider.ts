import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WebviewProvider } from './WebviewProvider';
import { SettingsService, ValidationService, TomcatService, GradleService, ProjectService } from '../services';
import type { ChangedFiles, DeployFileList, MessageFromWebview, Settings, TomcatState, ValidationState } from '../types';
import { handleWebviewMessage, type IWebviewActionEngine } from './WebviewActionEngine';
import { TomcatStatusBar } from '../utils/TomcatStatusBar';
import { TomcatInitService } from '../services/TomcatInitService';
import { DeployService } from '../services/DeployService';
import { ReferenceAnalysisProvider } from './ReferenceAnalysisProvider';
import { UxStudioService } from '../services/UxStudioService';

// 콘솔 출력 채널
const OUTPUT_CHANNEL_NAME = 'XPlatform 통합 개발환경';

// 통합 패널 프로바이더
export class UnifiedPanelProvider extends WebviewProvider {
    private _settingsService: SettingsService; // 설정 화면 서비스
    private _projectService: ProjectService; // 프로젝트 설정 화면 서비스
    private _validationService: ValidationService; // Tool 검증 서비스 (설정 화면)
    private _gradleService: GradleService; // Gradle 패널 서비스 (메인 화면)
    private _tomcatService: TomcatService;  // Tomcat 제어 서비스 (메인 화면)
    private _tomcatInitService: TomcatInitService; // Tomcat 초기화 서비스 (메인 화면)
    private _deployService: DeployService; // 배포 서비스
    private _tomcatStatusBar: TomcatStatusBar; // Tomcat 실행 시 하단 상태바 서비스 (메인 화면)
    private _uxStudioService: UxStudioService; // UX Studio 관리 서비스
    private _settings: Settings; // Tool Path 등 설정 상태값 관리
    private _validation: ValidationState; // Tool 검증 상태값 관리
    private _tomcatState: TomcatState;  // tomcat 관련 상태값 관리
    private _log = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME); // 로그 출력 채널

    private _stoppingTimeout?: NodeJS.Timeout;

    // 배포 관련 상태값 관리
    private _deployFileList: DeployFileList = { java: [], query: [] }; // 선택모드에서의 배포대상 목록
    private _fileWatchers: vscode.FileSystemWatcher[] = [];
    private _changedFiles: ChangedFiles = { java: [], query: [] }; // Tomcat 기동 중 변경된 파일 목록

    constructor(extensionUri: vscode.Uri, context?: vscode.ExtensionContext) {
        super(extensionUri);

        this._settings = {
            projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
            gradlePath: '',
            jdkPath: '',
            tomcatPath: '',
        };

        this._validation = {
            isFirstLoaded: false,
            isValidating: false,
            allValid: false,
            projectValid: false,
            gradle: { status: 'pending', message: '' },
            jdk: { status: 'pending', message: '' },
            tomcat: { status: 'pending', message: '' },
            jdk_has_dcevm: false,
        };

        this._tomcatState = {
            initialized: false,
            contextRoot: '',
            running: false,
            debugMode: false,
            portsBlocked: false,
            deployMode: 'default',
            deployPath: '',
            profile: 'local',
            isBatch: false,
            initializing: false,
            starting: false,
            stopping: false,
            isHotReloadMode: true,
        };

        this._settingsService = new SettingsService(this._log, this._settings);
        this._validationService = new ValidationService(this._log, this._validation);
        this._tomcatService = new TomcatService(this._log, this._settings, this._tomcatState, this._extensionUri, () => {
            this._tomcatState.starting = false;
            this._updateTomcatStatusBar();
            this._sendTomcatState();
        });
        this._tomcatInitService = new TomcatInitService(this._log, this._settings, this._tomcatState, this._extensionUri, this._deployFileList);
        this._gradleService = new GradleService(this._log, this._settings, () => this._notifyGradleComplete());
        this._projectService = new ProjectService(this._log, this._settings, this._extensionUri);
        this._deployService = new DeployService(this._log, this._settings, this._deployFileList, this._changedFiles, this._fileWatchers, this._tomcatState, this._gradleService, this._tomcatService);
        this._tomcatInitService.setDeployService(this._deployService);
        this._tomcatStatusBar = new TomcatStatusBar();
        this._uxStudioService = new UxStudioService(this._log, this._settings.projectRoot);
        if (context) {
            context.subscriptions.push(this._tomcatStatusBar);
            context.subscriptions.push(new vscode.Disposable(() => this.dispose()));
        }
    }

    /** 확장 비활성화(VS Code 종료 등) 시 호출. FileWatcher 등 리소스 해제로 메모리 누수 방지 */
    public dispose(): void {
        this._deployService.stopFileWatcher();
        this._uxStudioService.stopMyChangesWatcher();
    }

    // UI 로딩이 완료되었을 때 최초 1회 수행
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'webview-dist'),
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 메시지 핸들러 등록
        webviewView.webview.onDidReceiveMessage(async (data: MessageFromWebview) => {
            await (data => handleWebviewMessage(data, this._getActionEngine()))(data);
        });
    }

    // UI → 내부 엔진 액션 전달용 엔진 객체. IWebviewActionEngine 인터페이스에 선언된 Action을 모두 구현해야 한다.
    private _getActionEngine(): IWebviewActionEngine {
        return {
            handleInitProject: () => this._handleInitProject(), // 최초 패널 오픈 핸들러
            sendState: () => this._sendState(), // 엔진에 있는 설정값들을 UI로 전달
            sendTomcatState: () => this._sendTomcatState(), // 엔진에 있는 tomcat 상태값들을 UI로 전달
            handleSelectFolder: (target, currentPath) => // 설정 창에서 찾아보기 버튼 클릭 시 폴더 선택 핸들러 (Gradle, JDK, Tomcat 경로 설정)
                this._settingsService.handleSelectFolder(() => this._sendState(), target, currentPath),

            handleValidateAll: () => // 설정 창에서 전체 검증 핸들러
                this._validationService.validateAll(
                    this._settings,
                    () => this._sendState(),
                    () => {

                        this._settingsService.saveSettings();
                        // .vscode 폴더가 없으면 프로젝트 설정 자동 초기화
                        const vscodePath = path.join(this._settings.projectRoot, '.vscode');
                        if (!fs.existsSync(vscodePath)) {
                            this._projectService.initProjectSettings({ hideSimpleFolder: true, hideExtFolder: false, initProjectFile: true });
                        }
                        this._postMessage({ type: 'navigateTo', page: 'main' });
                    }
                ),
            initGlobalSettings: () => // 설정 창에서 전역 설정 초기화 핸들러
                this._settingsService.initGlobalSettings(),
            buildClasses: () => // 메인 창에서 빌드(classes) 핸들러
                this._gradleService.buildClasses(),
            cleanProject: () => // 메인 창에서 초기화(clean) 핸들러
                this._gradleService.cleanProject(),
            stopGradle: () => // 메인 창에서 Gradle 중지 핸들러
                this._gradleService.stopGradle(),
            initTomcat: async (contextRoot, profile, isBatch, deployMode) => {// 메인 창에서 Tomcat 초기화 핸들러
                this._tomcatState.initializing = true;
                this._log.show(true);
                this._log.appendLine('Tomcat 초기화 시작');
                this._postMessage({ type: 'tomcatStateUpdate', tomcat: this._tomcatState });
                await new Promise(resolve => setTimeout(resolve, 0)); // UI 반영 대기 (이벤트 루프 양보)
                // Tocmat 초기화
                await this._tomcatInitService.initTomcat(contextRoot, profile, isBatch, deployMode);
                // 초기화 완료 후 상태 업데이트 (초기화 성공/실패 무관하게 업데이트 필요)
                this._tomcatState.initializing = false;
                this._postMessage({ type: 'tomcatStateUpdate', tomcat: this._tomcatState });
                return Promise.resolve();
            },
            startTomcat: (enableHotswap) => { // 메인 창에서 Tomcat 시작 핸들러
                this._tomcatState.starting = true;
                this._tomcatState.running = true;
                this._tomcatState.debugMode = false;
                this._tomcatState.isHotReloadMode = enableHotswap;
                this._sendTomcatState();
                this._updateTomcatStatusBar();
                this._deployService.startFileWatcher((msg) => this._postMessage(msg));
                this._tomcatService.startTomcat(enableHotswap, () => {
                    // tomcat 기동이 완료되면 후처리하는 콜백 함수
                    this._tomcatState.starting = false;
                    this._updateTomcatStatusBar();
                    this._sendTomcatState();
                }, () => this._tomcatInitService.deployServiceFiles(this._tomcatState.contextRoot, this._tomcatState.deployMode, this._tomcatService.isDeveloperMode));

                return Promise.resolve();
            },
            debugTomcat: async (enableHotswap) => { // 메인 창에서 Tomcat 디버그 핸들러
                this._tomcatState.starting = true;
                this._tomcatState.running = true;
                this._tomcatState.debugMode = true;
                this._tomcatState.isHotReloadMode = enableHotswap;
                this._sendTomcatState();
                this._updateTomcatStatusBar();
                this._deployService.startFileWatcher((msg) => this._postMessage(msg));
                await this._tomcatService.debugTomcat(
                    enableHotswap,
                    () => {
                        this._tomcatState.starting = false;
                        this._updateTomcatStatusBar();
                        this._sendTomcatState();
                    },
                    () => this._tomcatInitService.deployServiceFiles(this._tomcatState.contextRoot, this._tomcatState.deployMode, this._tomcatService.isDeveloperMode)
                );
            },
            stopTomcat: async () => { // 메인 창에서 Tomcat 중지 핸들러
                this._tomcatState.stopping = true;
                this._tomcatState.running = false;
                this._tomcatState.debugMode = false;
                this._sendTomcatState();
                this._updateTomcatStatusBar();
                await new Promise(resolve => setTimeout(resolve, 0)); // UI 반영 대기 (이벤트 루프 양보)
                if (this._tomcatState.starting) {
                    this._tomcatService.killTomcatProcess();
                } else {
                    await this._tomcatService.stopTomcat();
                    this._tomcatService.killProcessesOnTomcatPorts();
                }
                this._tomcatState.starting = false;
                this._deployService.stopFileWatcher();
                if (this._stoppingTimeout) clearTimeout(this._stoppingTimeout);
                this._stoppingTimeout = setTimeout(() => {
                    this._tomcatState.stopping = false;
                    this._stoppingTimeout = undefined;
                    this._updateTomcatStatusBar();
                    this._sendTomcatState();
                }, 2500);
                return Promise.resolve();
            },
            killTomcatPorts: () => { // 포트 블록 해제: 7001, 12001 포트 프로세스 종료
                this._tomcatService.killProcessesOnTomcatPorts();
                this._tomcatState.running = false;
                this._tomcatState.debugMode = false;
                this._updateTomcatStatusBar();
                this._postMessage({ type: 'tomcatStateUpdate', tomcat: this._tomcatState });
                return Promise.resolve();
            },
            handleApplyProjectSettings: (options) => // 프로젝트 창에서 프로젝트 설정 초기화 핸들러
                this._projectService.initProjectSettings(options),
            handleSetupHomeSettings: () => // 프로젝트 창에서 사용자 홈 설정 적용 핸들러
                this._projectService.handleApplyHomeSettings(),
            searchDeployFiles: async (keyword) => { // 배포목록관리 팝업에서 파일검색 기능
                const filtered = await this._deployService.searchDeployFiles(keyword);
                this._postMessage({ type: 'deployFilesSearchResult', searchResult: filtered });
            },
            updateDeployFiles: (deployFileList, targetFile, fileType, changeType) => { // 배포목록관리 팝업에서 배포목록 업데이트 핸들러
                this._deployService.updateDeployList(deployFileList, targetFile, fileType, changeType);
                if (this._tomcatState.running && changeType === 'add') this._postMessage({ type: 'changedFilesUpdate', changedFiles: this._changedFiles });
            },
            applyChangedFiles: async () => { // tomcat 기동 중 변경된 파일을 로컬 서버에 적용
                await this._deployService.applyChangedFiles();
                this._postMessage({ type: 'changedFilesUpdate', changedFiles: this._changedFiles });
            },
            analyzeReferenceChain: async (javaFiles: string[]) => {
                await this._deployService.analyzeReferenceChain(javaFiles);
                this._postMessage({ type: 'mainStateUpdate', deployFileList: this._deployFileList });
            },
            clearDeployFiles: () => { // 배포목록관리 데이터 초기화
                this._deployService.clearDeployFiles();
                this._postMessage({ type: 'favoriteCleared' }); // 즐겨찾기 활성 상태 리셋
            },
            loadFavorites: async () => { // 즐겨찾기 목록 조회 (리프레시 버튼 클릭)
                const favorites = await this._deployService.loadFavorites();
                this._postMessage({ type: 'favoritesListResult', favorites });
            },
            saveFavorite: async (name, java, query) => { // 새 즐겨찾기 저장
                const saved = this._deployService.saveFavorite(name, java, query);
                const favorites = await this._deployService.loadFavorites();
                this._postMessage({ type: 'favoriteApplied', deployFileList: this._deployFileList, favoriteId: saved.id, favoriteName: saved.name });
                this._postMessage({ type: 'favoritesListResult', favorites });
            },
            overwriteFavorite: async (id, java, query) => { // 즐겨찾기 덮어쓰기
                const updated = this._deployService.overwriteFavorite(id, java, query);
                if (updated) {
                    const favorites = await this._deployService.loadFavorites();
                    this._postMessage({ type: 'favoriteApplied', deployFileList: this._deployFileList, favoriteId: updated.id, favoriteName: updated.name });
                    this._postMessage({ type: 'favoritesListResult', favorites });
                }
            },
            applyFavorite: (id) => { // 즐겨찾기 불러오기
                const applied = this._deployService.applyFavorite(id);
                if (applied) {
                    this._postMessage({ type: 'favoriteApplied', deployFileList: this._deployFileList, favoriteId: applied.id, favoriteName: applied.name });
                }
            },
            deleteFavorite: async (id) => { // 즐겨찾기 삭제
                this._deployService.deleteFavorite(id);
                const favorites = await this._deployService.loadFavorites();
                this._postMessage({ type: 'favoritesListResult', favorites });
            },
            log: (message) => this._log.appendLine(message), // 로그 출력 핸들러
            // UX Studio
            uxStudioInit: async () => {
                this._uxStudioService.updateProjectRoot(this._settings.projectRoot);
                const isDevMode = this._uxStudioService.checkDevMode();
                if (!isDevMode) {
                    this._postMessage({ type: 'uxStudioResult', uxIsDevMode: false });
                    return;
                }
                const status = this._uxStudioService.checkSetupStatus();
                const allServices = this._uxStudioService.parseDefaultTypedef();
                const customServices = this._uxStudioService.getCustomServices(allServices);
                const envConfig = status === 'configured' ? this._uxStudioService.loadEnvConfig() : null;
                const xprjFiles = this._uxStudioService.getXprjFiles();
                const xfdlFiles = status === 'configured' ? this._uxStudioService.searchXfdlFiles() : [];
                if (status === 'configured') {
                    this._uxStudioService.startMyChangesWatcher();
                }
                this._postMessage({
                    type: 'uxStudioResult',
                    uxIsDevMode: true,
                    uxStudioStatus: status,
                    uxServices: allServices,
                    uxEnvConfig: envConfig ?? undefined,
                    uxXfdlFiles: xfdlFiles,
                    uxXprjFiles: xprjFiles,
                });
            },
            uxStudioApplySettings: async (config) => {
                const allServices = this._uxStudioService.parseDefaultTypedef();
                await this._uxStudioService.applySettings(config, allServices);
                const xprjFiles = this._uxStudioService.getXprjFiles();
                const xfdlFiles = this._uxStudioService.searchXfdlFiles();
                this._uxStudioService.startMyChangesWatcher();
                this._postMessage({
                    type: 'uxStudioResult',
                    uxIsDevMode: true,
                    uxStudioStatus: 'configured' as const,
                    uxEnvConfig: config,
                    uxXfdlFiles: xfdlFiles,
                    uxXprjFiles: xprjFiles,
                });
            },
            uxStudioSearchXfdl: async () => {
                const xfdlFiles = this._uxStudioService.searchXfdlFiles();
                this._postMessage({ type: 'uxStudioXfdlResult', uxXfdlFiles: xfdlFiles });
            },
            uxStudioConfirmFiles: async (selectedFiles) => {
                await this._uxStudioService.confirmFiles(selectedFiles);
                const xprjFiles = this._uxStudioService.getXprjFiles();
                this._postMessage({ type: 'uxStudioXprjResult', uxXprjFiles: xprjFiles });
            },
            uxStudioLaunchXprj: (filePath) => {
                this._uxStudioService.launchXprj(filePath);
            },
            uxStudioResetSetup: () => {
                this._uxStudioService.stopMyChangesWatcher();
                this._uxStudioService.resetSetup();
                const allServices = this._uxStudioService.parseDefaultTypedef();
                this._postMessage({
                    type: 'uxStudioResult',
                    uxIsDevMode: true,
                    uxStudioStatus: 'new' as const,
                    uxServices: allServices,
                });
            },
        };
    }

    private _sendTomcatState(): void {
        this._postMessage({ type: 'tomcatStateUpdate', tomcat: this._tomcatState });
    }

    // 패널이 최초 열렸을 때 수행되는 핸들러 - 프로젝트 구조 검증 및 도구가 모두 준비되었으면 Main 페이지로 이동
    private async _handleInitProject(): Promise<void> {
        if (this._validation.isFirstLoaded) { // 최초 초기화 수행은 이미 했고, 다시 패널 로드할 때는 최초 초기화 수행하지 않음
            if (this._validation.allValid) this._postMessage({ type: 'navigateTo', page: 'main', validation: this._validation });
            return;
        }
        this._validation.isFirstLoaded = true;
        this._validationService.validateProjectStructure(this._settingsService.projectRoot); // 프로젝트 구조 검증
        if (this._settingsService.loadSavedSettings()) this._validationService.setAsValidated(this._settingsService.settings);
        this._syncContextRootFromServerXml();
        if (!this._tomcatState.initialized || !this._tomcatState.contextRoot) {
            this._syncContextRootFromWebXml();
        }
        this._deployService.loadDeploySettings(); // 배포 설정 파일에서 복원
        if (!this._tomcatState.running && this._tomcatService.areTomcatPortsInUse()) this._tomcatState.portsBlocked = true; // 타 프로세스가 7001, 12001 포트를 사용 중이면 포트 블록 상태로 설정
        this._updateTomcatStatusBar();
        // 즐겨찾기 목록 최초 로드
        const favorites = await this._deployService.loadFavorites();
        this._postMessage({ type: 'favoritesListResult', favorites });
        if (this._validation.allValid) this._postMessage({ type: 'navigateTo', page: 'main', validationState: this._validation });
    }

    // vscode 소스목록 또는 에디터 상단 헤더 우클릭 통한 파일 배포 대상 추가 핸들러
    public addDeployTargetFile(filePath: string): void {
        this._deployService.addDeployListFromEditor(filePath);
        this._postMessage({ type: 'mainStateUpdate', deployFileList: this._deployFileList, changedFiles: this._changedFiles }); // 상태 전송
    }

    // server.xml에서 Context path를 읽어 _tomcatState.contextRoot에 반영
    private _syncContextRootFromServerXml(): void {
        const tomcatDir = path.join(this._settings.projectRoot, '.tomcat');
        const serverXmlPath = path.join(tomcatDir, 'conf', 'server.xml');
        if (!fs.existsSync(tomcatDir) || !fs.existsSync(serverXmlPath)) return;
        try {
            const content = fs.readFileSync(serverXmlPath, 'utf8');
            const match = content.match(/<Context\b[^>]*\spath\s*=\s*["']([^"']*)["']/);
            if (match && match[1]) {
                this._tomcatState.contextRoot = match[1].replace(/^\//, '');
                this._tomcatState.initialized = true;
            }
        } catch {
            // 파싱 실패 시 무시
        }
    }

    // 프로젝트 web.xml의 <display-name>을 읽어 _tomcatState.contextRoot에 반영 (server.xml 미반영 시 fallback)
    private _syncContextRootFromWebXml(): void {
        const webXmlPath = path.join(this._settings.projectRoot, 'src', 'webapp', 'WEB-INF', 'web.xml');
        if (!fs.existsSync(webXmlPath)) return;
        try {
            const content = fs.readFileSync(webXmlPath, 'utf8');
            const match = content.match(/<display-name>\s*([\s\S]*?)\s*<\/display-name>/);
            if (match && match[1] !== undefined) {
                this._tomcatState.contextRoot = match[1].trim();
            }
        } catch {
            // 파싱 실패 시 무시
        }
    }

    private _updateTomcatStatusBar(): void {
        this._tomcatStatusBar.update(
            this._tomcatState.running,
            this._tomcatState.debugMode,
            this._tomcatState.stopping,
            this._tomcatState.starting
        );
    }

    private _notifyGradleComplete(): void {
        this._postMessage({
            type: 'mainStateUpdate',
            isGradleRunning: false,
            settings: this._settings,
        });
    }

    // 내부 엔진에 있는 설정값들을 UI로 전달
    private _sendState(): void {
        this._updateTomcatStatusBar();
        this._postMessage({
            type: 'mainStateUpdate',
            settings: this._settingsService.settings,
            tomcat: this._tomcatState,
            validation: this._validation,
            deployFileList: this._deployFileList,
            changedFiles: this._changedFiles,
        });
    }

    // 배포대상 여부를 판단하는 함수 (데코레이션 프로바이더에서 사용)
    public hasDeployTargetFile(filePath: string): boolean {
        const normalized = filePath.replace(/\\/g, '/');
        return this._deployFileList.java.includes(normalized) || this._deployFileList.query.includes(normalized);
    }

    // 데코레이션 프로바이더 업데이트를 위한 콜백함수 등록
    public setOnDeployListChanged(refresh: (uri: any) => void) {
        this._deployService.setOnDeployListChanged(refresh);
    }
}
