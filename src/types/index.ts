// ==================== UX Studio ====================
export interface UxServiceEntry {
    prefixid: string;
    type: string;
    url: string;
    version: string;
    communicationversion: string;
    cachelevel: string;
}

export interface UxStudioEnvConfig {
    mode: 'default' | 'selected';
    customPrefixIds: string[];  // 커스텀 체크박스 선택된 prefixid 목록
    urlAutoCorrect: boolean;    // url 자동보정
}

// ==================== Settings ====================
export interface Settings {
    projectRoot: string;
    gradlePath: string;
    jdkPath: string;
    tomcatPath: string;
}

// ==================== Validation ====================
export type ValidationStatus = 'pending' | 'validating' | 'valid' | 'warning' | 'invalid';
export type TomcatDeployMode = 'default' | 'selected';
export type DeployFileList = { java: string[], query: string[] };
export type ChangedFiles = { java: string[], query: string[] };

// ==================== Deploy Favorite ====================
export interface DeployFavorite {
    id: string;
    name: string;
    java: string[];
    query: string[];
}

export interface ValidationItem {
    status: ValidationStatus;
    message: string;
    version?: string;
}

export interface ProjectValidation {
    valid: boolean;
    message: string;
}

export interface ValidationState {
    isFirstLoaded: boolean;
    isValidating: boolean;
    allValid: boolean;
    projectValid: boolean;
    gradle: ValidationItem;
    jdk: ValidationItem;
    tomcat: ValidationItem;
    jdk_has_dcevm: boolean;
}

// ==================== Tomcat ====================
export interface TomcatState {
    initialized: boolean;
    contextRoot: string;
    running: boolean;
    debugMode: boolean;
    portsBlocked: boolean;
    deployMode: TomcatDeployMode;
    deployPath: string;
    profile: string;
    isBatch: boolean;
    initializing: boolean;
    starting: boolean;
    stopping: boolean;
    isHotReloadMode: boolean;
}

// ==================== Project Settings Options ====================
export interface ProjectSettingsOptions {
    hideSimpleFolder: boolean;
    hideExtFolder: boolean;
    initProjectFile: boolean;
}

// ==================== Messages ====================
export type MessageFromWebview =
    | { type: 'initProject' }
    | { type: 'selectFolder'; target: string; currentPath?: string }
    | { type: 'validateAll' }
    | { type: 'initGlobalSettings' }
    | { type: 'buildClasses' }
    | { type: 'cleanProject' }
    | { type: 'stopGradle' }
    | { type: 'initTomcat'; contextRoot: string; profile: string; isBatch: boolean; deployMode: 'default' | 'selected'; selectedFiles: { java: string[], query: string[] } }
    | { type: 'startTomcat'; enableHotswap: boolean }
    | { type: 'debugTomcat'; enableHotswap: boolean }
    | { type: 'stopTomcat' }
    | { type: 'killTomcatPorts' }
    | { type: 'applyProjectSettings'; options: ProjectSettingsOptions }
    | { type: 'setupHomeSettings' }
    | { type: 'updateDeployFiles'; deployFileList: { java: string[], query: string[] }, targetFile: string, fileType: string, changeType: string }
    | { type: 'searchDeployFiles'; keyword: string }
    | { type: 'getChangedFiles' }
    | { type: 'clearChangedFiles' }
    | { type: 'applyChangedFiles' }
    | { type: 'analyzeReferenceChain'; javaFiles: string[] }
    | { type: 'clearDeployFiles' }
    | { type: 'loadFavorites' }
    | { type: 'saveFavorite'; name: string; java: string[]; query: string[] }
    | { type: 'overwriteFavorite'; id: string; java: string[]; query: string[] }
    | { type: 'applyFavorite'; id: string }
    | { type: 'deleteFavorite'; id: string }
    // UX Studio
    | { type: 'uxStudioInit' }
    | { type: 'uxStudioApplySettings'; config: UxStudioEnvConfig }
    | { type: 'uxStudioSearchXfdl' }
    | { type: 'uxStudioConfirmFiles'; selectedFiles: string[] }
    | { type: 'uxStudioLaunchXprj'; filePath: string }
    | { type: 'uxStudioResetSetup' };
