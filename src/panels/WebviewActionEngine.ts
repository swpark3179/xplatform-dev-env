import type { ProjectSettingsOptions, TomcatDeployMode } from '../types';
import type { WebviewMessage } from '../types/webviewMessage';

/**
 * 내부 엔진이 UI 액션을 처리하기 위해 필요한 API.
 * 웹뷰 메시지를 받아 해당 액션을 실행할 때 이 인터페이스를 통해 호출한다.
 */
export interface IWebviewActionEngine {
    initGlobalSettings(): unknown;
    sendState(): void;
    sendTomcatState(): void;
    handleInitProject(): Promise<void>;
    handleSelectFolder(target: string, currentPath?: string): Promise<void>;
    handleValidateAll(): Promise<void>;
    buildClasses(): void;
    cleanProject(): void;
    stopGradle(): void;
    initTomcat(contextRoot: string, profile: string, isBatch: boolean, deployMode: TomcatDeployMode): Promise<void>;
    startTomcat(enableHotswap: boolean): Promise<void>;
    debugTomcat(enableHotswap: boolean): Promise<void>;
    stopTomcat(): Promise<void>;
    killTomcatPorts(): Promise<void>;
    handleApplyProjectSettings(options: ProjectSettingsOptions): Promise<void>;
    handleSetupHomeSettings(): Promise<void>;
    updateDeployFiles(deployFileList: { java: string[], query: string[], batch: string[] }, targetFile: string, fileType: string, changeType: string): void;
    searchDeployFiles(keyword: string): Promise<void>;
    ensureDeployFileIndex(): void;
    refreshDeployFileIndex(): void;
    getAllDeployableFiles(): Promise<void>;
    applyChangedFiles(): Promise<void>;
    analyzeReferenceChain(javaFiles: string[]): Promise<void>;
    clearDeployFiles(): void;
    loadFavorites(): Promise<void> | void;
    saveFavorite(name: string, java: string[], query: string[], batch: string[]): Promise<void> | void;
    overwriteFavorite(id: string, java: string[], query: string[], batch: string[]): Promise<void> | void;
    applyFavorite(id: string): void;
    deleteFavorite(id: string): Promise<void> | void;
    log?(message: string): void;
    // UX Studio
    uxStudioInit(): Promise<void>;
    uxStudioApplySettings(config: import('../types').UxStudioEnvConfig): Promise<void>;
    uxStudioSearchXfdl(): Promise<void>;
    uxStudioConfirmFiles(selectedFiles: string[]): Promise<{ success: boolean; failedFiles: string[] }>;
    uxStudioLaunchXprj(filePath: string): void;
    uxStudioResetSetup(): Promise<void>;
    // Git local ignore
    gitIgnoreList(): Promise<void>;
    gitIgnoreApply(path: string): Promise<void>;
    gitIgnoreRelease(path: string): Promise<void>;
    gitIgnoreAddFile(): Promise<void>;
    gitIgnoreSync(): Promise<void>;
}

/**
 * 웹뷰에서 전달된 메시지에 따라 내부 엔진 액션을 실행한다.
 * UI → 엔진 방향의 액션 전달용.
 */
export async function handleWebviewMessage(
    data: WebviewMessage,
    engine: IWebviewActionEngine
): Promise<void> {
    switch (data.type) {
        case 'initProject':
            await engine.handleInitProject();
            engine.sendState();
            break;
        case 'selectFolder':
            await engine.handleSelectFolder(data.target, data.currentPath);
            break;
        case 'validateAll':
            await engine.handleValidateAll();
            break;
        case 'initGlobalSettings':
            engine.initGlobalSettings();
            break;
        case 'buildClasses':
            engine.buildClasses();
            break;
        case 'cleanProject':
            engine.cleanProject();
            break;
        case 'stopGradle':
            engine.stopGradle();
            break;
        case 'initTomcat':
            await engine.initTomcat(data.contextRoot, data.profile, data.isBatch, data.deployMode);
            engine.sendTomcatState();
            break;
        case 'startTomcat':
            await engine.startTomcat(data.enableHotswap);
            engine.sendTomcatState();
            break;
        case 'debugTomcat':
            await engine.debugTomcat(data.enableHotswap);
            engine.sendTomcatState();
            break;
        case 'stopTomcat':
            await engine.stopTomcat();
            engine.sendTomcatState();
            break;
        case 'killTomcatPorts':
            await engine.killTomcatPorts();
            break;
        case 'applyProjectSettings':
            await engine.handleApplyProjectSettings(data.options);
            break;
        case 'setupHomeSettings':
            await engine.handleSetupHomeSettings();
            break;
        case 'updateDeployFiles':
            engine.updateDeployFiles(data.deployFileList, data.targetFile, data.fileType, data.changeType);
            break;
        case 'searchDeployFiles':
            if (!data.keyword) return;
            await engine.searchDeployFiles(data.keyword);
            break;
        case 'ensureDeployFileIndex':
            engine.ensureDeployFileIndex();
            break;
        case 'refreshDeployFileIndex':
            engine.refreshDeployFileIndex();
            break;
        case 'getAllDeployableFiles':
            await engine.getAllDeployableFiles();
            break;
        case 'applyChangedFiles':
            await engine.applyChangedFiles();
            break;
        case 'analyzeReferenceChain':
            if (!Array.isArray(data.javaFiles)) return;
            await engine.analyzeReferenceChain(data.javaFiles);
            break;
        case 'clearDeployFiles':
            engine.clearDeployFiles();
            break;
        case 'loadFavorites':
            await engine.loadFavorites();
            break;
        case 'saveFavorite':
            if (!data.name || !Array.isArray(data.java) || !Array.isArray(data.query)) return;
            await engine.saveFavorite(data.name, data.java, data.query, Array.isArray(data.batch) ? data.batch : []);
            break;
        case 'overwriteFavorite':
            await engine.overwriteFavorite(data.id, data.java, data.query, Array.isArray(data.batch) ? data.batch : []);
            break;
        case 'applyFavorite':
            if (!data.id) return;
            engine.applyFavorite(data.id);
            break;
        case 'deleteFavorite':
            await engine.deleteFavorite(data.id);
            break;
        // UX Studio
        case 'uxStudioInit':
            await engine.uxStudioInit();
            break;
        case 'uxStudioApplySettings':
            await engine.uxStudioApplySettings(data.config);
            break;
        case 'uxStudioSearchXfdl':
            await engine.uxStudioSearchXfdl();
            break;
        case 'uxStudioConfirmFiles':
            await engine.uxStudioConfirmFiles(data.selectedFiles);
            break;
        case 'uxStudioLaunchXprj':
            engine.uxStudioLaunchXprj(data.filePath);
            break;
        case 'uxStudioResetSetup':
            await engine.uxStudioResetSetup();
            break;
        case 'gitIgnoreList':
            await engine.gitIgnoreList();
            break;
        case 'gitIgnoreApply':
            if (!data.path) return;
            await engine.gitIgnoreApply(data.path);
            break;
        case 'gitIgnoreRelease':
            if (!data.path) return;
            await engine.gitIgnoreRelease(data.path);
            break;
        case 'gitIgnoreAddFile':
            await engine.gitIgnoreAddFile();
            break;
        case 'gitIgnoreSync':
            await engine.gitIgnoreSync();
            break;
    }
}
