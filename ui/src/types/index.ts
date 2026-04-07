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
    customPrefixIds: string[];
    urlAutoCorrect: boolean;
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
/** Tomcat 코어 상태 (자주 바뀌지 않는 값). hotReloading/deployMode는 별도 state로 관리 */
export interface TomcatCoreState {
    initialized: boolean;
    contextRoot: string;
    portsBlocked: boolean;
    deployPath: string;
}

export interface TomcatRunningState {
    running: boolean;
    debugMode: boolean;
    initializing: boolean;
    starting: boolean;
    stopping: boolean;
}

/** UI에서 사용하는 Tomcat 전체 상태 (코어 + 자주 변경되는 값) */
export interface TomcatState extends TomcatCoreState, TomcatRunningState {
    deployMode: TomcatDeployMode;
    profile: string;
    isBatch: boolean;
    isHotReloadMode: boolean;
}

// ==================== Messages ====================
export interface MessageFromExtension {
    type: string;
    settings?: Settings;
    validation?: ValidationState;
    tomcat?: TomcatState;
    isGradleRunning?: boolean;
    page?: string;
    deployFileList?: { java: string[], query: string[] };
    searchResult?: string[];
    changedFiles?: { java: string[], query: string[] };
    // 즐겨찾기 관련
    favorites?: DeployFavorite[];
    favoriteId?: string;
    favoriteName?: string;
    // UX Studio
    uxIsDevMode?: boolean;
    uxStudioStatus?: 'new' | 'configured';
    uxServices?: UxServiceEntry[];
    uxEnvConfig?: UxStudioEnvConfig | null;
    uxXfdlFiles?: string[];
    uxXprjFiles?: string[];
}

export interface ProjectSettingsOptions {
    hideSimpleFolder: boolean;
    hideExtFolder: boolean;
    initProjectFile: boolean;
}
