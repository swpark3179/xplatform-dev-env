import { useState, useEffect, useMemo } from 'react';
import { onMessage } from '../vscode';
import type { DeployFavorite, DeployFileIndexState, Settings, ValidationState, TomcatCoreState, TomcatState, MessageFromExtension, TomcatRunningState, UxServiceEntry, UxStudioEnvConfig } from '../types';
import { useAppActions } from './useAppActions';

const initialSettings: Settings = {
    projectRoot: '',
    gradlePath: '',
    jdkPath: '',
    tomcatPath: '',
};

const initialValidation: ValidationState = {
    isFirstLoaded: false,
    isValidating: false,
    allValid: false,
    projectValid: false,
    gradle: { status: 'pending', message: '' },
    jdk: { status: 'pending', message: '' },
    tomcat: { status: 'pending', message: '' },
    jdk_has_dcevm: false,
};

const initialTomcatCore: TomcatCoreState = {
    initialized: false,
    contextRoot: 'ROOT',
    portsBlocked: false,
    deployPath: '',
};

const initialTomcatRunning: TomcatRunningState = {
    running: false,
    debugMode: false,
    initializing: false,
    starting: false,
    stopping: false,
};

const initialDeployFileIndex: DeployFileIndexState = {
    status: 'idle',
    phase: 'idle',
    indexedCount: 0,
    javaCount: 0,
    queryCount: 0,
    batchCount: 0,
};

// 앱 전역 상태 관리 훅
export function useAppState() {
    // 네비게이션
    const [currentPage, setCurrentPage] = useState<'settings' | 'main' | 'project-settings' | 'ux-studio'>('settings');

    // 설정·검증
    const [settings, setSettings] = useState<Settings>(initialSettings);
    const [validation, setValidation] = useState<ValidationState>(initialValidation);

    // Tomcat: 코어는 한 덩어리, 자주 바뀌는 값은 별도 state (갱신 범위 최소화)
    const [tomcatCore, setTomcatCore] = useState<TomcatCoreState>(initialTomcatCore);
    const [tomcatRunning, setTomcatRunning] = useState<TomcatRunningState>(initialTomcatRunning);
    const [tomcatDeployMode, setTomcatDeployMode] = useState<'default' | 'selected'>('default');
    const [tomcatProfile, setTomcatProfile] = useState('local');
    const [tomcatIsBatch, setTomcatIsBatch] = useState(false);
    const [tomcatIsHotReloading, setTomcatIsHotReloading] = useState(true);

    // 빌드
    const [isGradleRunning, setIsGradleRunning] = useState(false);

    // 배포 파일
    const [deployFileList, setDeployFileList] = useState<{ java: string[], query: string[], batch: string[] }>({ java: [], query: [], batch: [] });
    const [searchResult, setSearchResult] = useState<string[]>([]);
    const [deployFileIndex, setDeployFileIndex] = useState<DeployFileIndexState>(initialDeployFileIndex);
    const [allDeployableFiles, setAllDeployableFiles] = useState<string[]>([]);
    const [changedFiles, setChangedFiles] = useState<{ java: string[], query: string[], batch: string[] }>({ java: [], query: [], batch: [] });

    // 즐겨찾기
    const [favorites, setFavorites] = useState<DeployFavorite[]>([]);
    const [activeFavoriteId, setActiveFavoriteId] = useState<string | null>(null);
    const [activeFavoriteName, setActiveFavoriteName] = useState<string | null>(null);

    // UX Studio
    const [uxIsDevMode, setUxIsDevMode] = useState<boolean | null>(null); // null = 미확인
    const [uxStudioStatus, setUxStudioStatus] = useState<'new' | 'configured' | null>(null);
    const [uxServices, setUxServices] = useState<UxServiceEntry[]>([]);
    const [uxEnvConfig, setUxEnvConfig] = useState<UxStudioEnvConfig | null>(null);
    const [uxXfdlFiles, setUxXfdlFiles] = useState<string[]>([]);
    const [uxXprjFiles, setUxXprjFiles] = useState<string[]>([]);
    const [uxConfirmErrorFiles, setUxConfirmErrorFiles] = useState<string[]>([]);

    // Tomcat 상태 업데이트는 별도로 만들어둠.
    const tomcatStateUpdate = (tomcatStateMsg: TomcatState) => {
        setTomcatCore({
            initialized: tomcatStateMsg.initialized,
            contextRoot: tomcatStateMsg.contextRoot,
            portsBlocked: tomcatStateMsg.portsBlocked,
            deployPath: tomcatStateMsg.deployPath,
        });
        setTomcatRunning({
            running: tomcatStateMsg.running,
            debugMode: tomcatStateMsg.debugMode,
            initializing: tomcatStateMsg.initializing,
            starting: tomcatStateMsg.starting,
            stopping: tomcatStateMsg.stopping,
        });
        if (tomcatStateMsg.deployMode !== undefined) setTomcatDeployMode(tomcatStateMsg.deployMode);
        if (tomcatStateMsg.profile !== undefined) setTomcatProfile(tomcatStateMsg.profile);
        if (tomcatStateMsg.isBatch !== undefined) setTomcatIsBatch(tomcatStateMsg.isBatch);
        if (tomcatStateMsg.isHotReloadMode !== undefined) setTomcatIsHotReloading(tomcatStateMsg.isHotReloadMode);
    }

    // Extension으로부터 메시지 수신
    useEffect(() => {
        const unsubscribe = onMessage((message: unknown) => {
            const msg = message as MessageFromExtension;

            switch (msg.type) {
                case 'stateUpdate':
                    if (msg.settings) setSettings(msg.settings);
                    break;
                case 'mainStateUpdate':
                    if (msg.settings) setSettings(msg.settings);
                    if (msg.isGradleRunning !== undefined) setIsGradleRunning(msg.isGradleRunning);
                    if (msg.tomcat) tomcatStateUpdate(msg.tomcat);
                    if (msg.validation) setValidation(msg.validation);
                    if (msg.deployFileList) setDeployFileList(msg.deployFileList);
                    if (msg.changedFiles) setChangedFiles(msg.changedFiles);
                    break;
                case 'navigateTo':
                    if (msg.validation) setValidation(msg.validation);
                    if (msg.page) setCurrentPage(msg.page as 'settings' | 'main' | 'project-settings' | 'ux-studio');
                    break;
                case 'tomcatStateUpdate':
                    if (msg.tomcat) tomcatStateUpdate(msg.tomcat);
                    break;
                case 'deployFilesSearchResult':
                    if (msg.searchResult) setSearchResult(msg.searchResult);
                    break;
                case 'deployFileIndexUpdate':
                    if (msg.deployFileIndex) setDeployFileIndex(msg.deployFileIndex);
                    if (msg.reset) {
                        setAllDeployableFiles(msg.filesBatch ?? []);
                    } else if (msg.filesBatch && msg.filesBatch.length > 0) {
                        setAllDeployableFiles(prev => [...prev, ...msg.filesBatch!]);
                    }
                    break;
                case 'allDeployableFilesResult':
                    if (msg.allFiles) setAllDeployableFiles(msg.allFiles);
                    break;
                case 'changedFilesUpdate':
                    if (msg.changedFiles) setChangedFiles(msg.changedFiles);
                    break;
                case 'referenceChainResult':
                    if (msg.deployFileList) setDeployFileList(msg.deployFileList);
                    break;
                case 'favoritesListResult':
                    if (msg.favorites) setFavorites(msg.favorites);
                    break;
                case 'favoriteApplied':
                    if (msg.deployFileList) setDeployFileList(msg.deployFileList);
                    if (msg.favoriteId !== undefined) setActiveFavoriteId(msg.favoriteId);
                    if (msg.favoriteName !== undefined) setActiveFavoriteName(msg.favoriteName);
                    break;
                case 'favoriteCleared':
                    setActiveFavoriteId(null);
                    setActiveFavoriteName(null);
                    break;
                case 'uxStudioResult':
                    if (msg.uxIsDevMode !== undefined) setUxIsDevMode(msg.uxIsDevMode);
                    if (msg.uxStudioStatus !== undefined) setUxStudioStatus(msg.uxStudioStatus);
                    if (msg.uxServices !== undefined) setUxServices(msg.uxServices);
                    if (msg.uxEnvConfig !== undefined) setUxEnvConfig(msg.uxEnvConfig);
                    if (msg.uxXfdlFiles !== undefined) setUxXfdlFiles(msg.uxXfdlFiles);
                    if (msg.uxXprjFiles !== undefined) setUxXprjFiles(msg.uxXprjFiles);
                    break;
                case 'uxStudioXfdlResult':
                    if (msg.uxXfdlFiles !== undefined) setUxXfdlFiles(msg.uxXfdlFiles);
                    break;
                case 'uxStudioXprjResult':
                    if (msg.uxXprjFiles !== undefined) setUxXprjFiles(msg.uxXprjFiles);
                    setUxConfirmErrorFiles([]); // 성공 시 에러 목록 초기화
                    break;
                case 'uxStudioConfirmError':
                    if (msg.type === 'uxStudioConfirmError') setUxConfirmErrorFiles((msg as unknown as { failedFiles: string[] }).failedFiles);
                    break;
            }
        });
        return unsubscribe;
    }, []);

    const actions = useAppActions({
        setCurrentPage,
        setIsGradleRunning,
        setSearchResult,
        setDeployFileList,
        setTomcatIsHotReloading,
        setChangedFiles,
        setUxStudioStatus,
        setUxConfirmErrorFiles,
    });

    // 계층적 state: 소스 이해·코드 간결화.
    const state = useMemo(() => ({
        navigation: { currentPage },
        settings,
        validation,
        build: { isGradleRunning },
        tomcat: {
            ...tomcatCore,
            ...tomcatRunning,
            deployMode: tomcatDeployMode,
            profile: tomcatProfile,
            isBatch: tomcatIsBatch,
            isHotReloadMode: tomcatIsHotReloading,
        } as TomcatState,
        deploy: {
            searchResult: searchResult,
            deployFileIndex: deployFileIndex,
            allDeployableFiles: allDeployableFiles,
            deployFileList: deployFileList,
            changedFiles: changedFiles,
            favorites: favorites,
            activeFavoriteId: activeFavoriteId,
            activeFavoriteName: activeFavoriteName,
        },
        uxStudio: {
            isDevMode: uxIsDevMode,
            status: uxStudioStatus,
            services: uxServices,
            envConfig: uxEnvConfig,
            xfdlFiles: uxXfdlFiles,
            xprjFiles: uxXprjFiles,
            confirmErrorFiles: uxConfirmErrorFiles,
        },
    }), [
        currentPage,
        settings,
        validation,
        isGradleRunning,
        tomcatCore,
        tomcatDeployMode,
        tomcatProfile,
        tomcatIsBatch,
        tomcatIsHotReloading,
        deployFileList,
        searchResult,
        deployFileIndex,
        allDeployableFiles,
        changedFiles,
        favorites,
        activeFavoriteId,
        activeFavoriteName,
        uxIsDevMode,
        uxStudioStatus,
        uxServices,
        uxEnvConfig,
        uxXfdlFiles,
        uxXprjFiles,
        uxConfirmErrorFiles,
    ]);

    return { state, actions };
}

export type AppActions = ReturnType<typeof useAppState>['actions'];

export type AppState = ReturnType<typeof useAppState>['state'];
