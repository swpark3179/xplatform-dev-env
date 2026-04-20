import { useMemo, useCallback } from 'react';
import { postMessage } from '../vscode';
import type { ProjectSettingsOptions, TomcatDeployMode } from '../types';

export type PageKind = 'settings' | 'main' | 'project-settings' | 'ux-studio';

export interface UseAppActionsDeps {
    setCurrentPage: (page: PageKind) => void;
    setIsGradleRunning: (value: boolean) => void;
    setSearchResult: (value: string[] | ((prev: string[]) => string[])) => void;
    setDeployFileList: (value: { java: string[], query: string[] }) => void;
    setTomcatIsHotReloading: (value: boolean) => void;
    setChangedFiles: (value: { java: string[], query: string[] }) => void;
    setUxStudioStatus: (value: 'new' | 'configured' | null) => void;
    setUxConfirmErrorFiles: React.Dispatch<React.SetStateAction<string[]>>;
}

/**
 * Extension 메시지 전송 및 로컬 상태 업데이트 액션 훅.
 * actions는 도메인별로 계층화되어 있음 (navigation, settings, build, tomcat, deploy, project).
 *
 * 주의: useCallback 은 반드시 컴포넌트(훅) 최상위에서 호출해야 하며,
 * useMemo 의 factory 내부에서 호출하면 Rules of Hooks 위반으로 훅 순서가
 * 렌더 간에 달라져 내부 상태가 깨진다.
 */
export function useAppActions(deps: UseAppActionsDeps) {
    const {
        setCurrentPage,
        setIsGradleRunning,
        setSearchResult,
        setDeployFileList,
        setTomcatIsHotReloading,
        setChangedFiles,
        setUxStudioStatus,
        setUxConfirmErrorFiles,
    } = deps;

    // navigation
    const goToSettings = useCallback(() => { setCurrentPage('settings'); }, [setCurrentPage]);
    const goToMain = useCallback(() => { setCurrentPage('main'); }, [setCurrentPage]);
    const goToProjectSettings = useCallback(() => { setCurrentPage('project-settings'); }, [setCurrentPage]);
    const goToUxStudio = useCallback(() => { setCurrentPage('ux-studio'); }, [setCurrentPage]);

    const navigation = useMemo(() => ({
        goToSettings,
        goToMain,
        goToProjectSettings,
        goToUxStudio,
    }), [goToSettings, goToMain, goToProjectSettings, goToUxStudio]);

    // settings
    const initProject = useCallback(() => { postMessage({ type: 'initProject' }); }, []);
    const initGlobalSettings = useCallback(() => { postMessage({ type: 'initGlobalSettings' }); }, []);
    const selectFolder = useCallback((target: string, currentPath?: string) => {
        postMessage({ type: 'selectFolder', target, currentPath });
    }, []);
    const validateAll = useCallback(() => { postMessage({ type: 'validateAll' }); }, []);

    const settings = useMemo(() => ({
        initProject,
        initGlobalSettings,
        selectFolder,
        validateAll,
    }), [initProject, initGlobalSettings, selectFolder, validateAll]);

    // build
    const buildClasses = useCallback(() => {
        setIsGradleRunning(true);
        postMessage({ type: 'buildClasses' });
    }, [setIsGradleRunning]);
    const cleanProject = useCallback(() => {
        setIsGradleRunning(true);
        postMessage({ type: 'cleanProject' });
    }, [setIsGradleRunning]);
    const stopGradle = useCallback(() => { postMessage({ type: 'stopGradle' }); }, []);

    const build = useMemo(() => ({
        buildClasses,
        cleanProject,
        stopGradle,
    }), [buildClasses, cleanProject, stopGradle]);

    // tomcat
    const initTomcat = useCallback((contextRoot: string, profile: string, isBatch: boolean, deployMode: TomcatDeployMode) => {
        postMessage({ type: 'initTomcat', contextRoot, profile, isBatch, deployMode });
    }, []);
    const startTomcat = useCallback((enableHotswap: boolean) => {
        postMessage({ type: 'startTomcat', enableHotswap });
    }, []);
    const debugTomcat = useCallback((enableHotswap: boolean) => {
        postMessage({ type: 'debugTomcat', enableHotswap });
    }, []);
    const stopTomcat = useCallback(() => { postMessage({ type: 'stopTomcat' }); }, []);
    const killTomcatPorts = useCallback(() => { postMessage({ type: 'killTomcatPorts' }); }, []);
    const setStateIsHotReloading = useCallback((value: boolean) => {
        setTomcatIsHotReloading(value);
    }, [setTomcatIsHotReloading]);

    const tomcat = useMemo(() => ({
        initTomcat,
        startTomcat,
        debugTomcat,
        stopTomcat,
        killTomcatPorts,
        setStateIsHotReloading,
    }), [initTomcat, startTomcat, debugTomcat, stopTomcat, killTomcatPorts, setStateIsHotReloading]);

    // deploy
    const updateDeployFiles = useCallback((deployFileList: { java: string[], query: string[] }, targetFile: string, fileType: string, changeType: string) => {
        setDeployFileList(deployFileList);
        postMessage({ type: 'updateDeployFiles', deployFileList, targetFile, fileType, changeType });
    }, [setDeployFileList]);
    const searchDeployFiles = useCallback((keyword: string) => {
        postMessage({ type: 'searchDeployFiles', keyword } as any);
    }, []);
    const getAllDeployableFiles = useCallback(() => {
        postMessage({ type: 'getAllDeployableFiles' } as any);
    }, []);
    const clearSearchResult = useCallback(() => { setSearchResult([]); }, [setSearchResult]);
    const applyChangedFiles = useCallback(() => {
        setChangedFiles({ java: [], query: [] });
        postMessage({ type: 'applyChangedFiles' } as any);
    }, [setChangedFiles]);
    const setStateSearchResult = useCallback((searchResult: string[]) => {
        setSearchResult(searchResult);
    }, [setSearchResult]);
    const analyzeReferenceChain = useCallback((javaFiles: string[]) => {
        postMessage({ type: 'analyzeReferenceChain', javaFiles } as any);
    }, []);
    const clearDeployFiles = useCallback(() => {
        setDeployFileList({ java: [], query: [] });
        postMessage({ type: 'clearDeployFiles' } as any);
    }, [setDeployFileList]);
    const loadFavorites = useCallback(() => {
        postMessage({ type: 'loadFavorites' } as any);
    }, []);
    const saveFavorite = useCallback((name: string, java: string[], query: string[]) => {
        postMessage({ type: 'saveFavorite', name, java, query } as any);
    }, []);
    const overwriteFavorite = useCallback((id: string, java: string[], query: string[]) => {
        postMessage({ type: 'overwriteFavorite', id, java, query } as any);
    }, []);
    const applyFavorite = useCallback((id: string) => {
        postMessage({ type: 'applyFavorite', id } as any);
    }, []);
    const deleteFavorite = useCallback((id: string) => {
        postMessage({ type: 'deleteFavorite', id } as any);
    }, []);

    const deploy = useMemo(() => ({
        updateDeployFiles,
        searchDeployFiles,
        getAllDeployableFiles,
        clearSearchResult,
        applyChangedFiles,
        setStateSearchResult,
        analyzeReferenceChain,
        clearDeployFiles,
        loadFavorites,
        saveFavorite,
        overwriteFavorite,
        applyFavorite,
        deleteFavorite,
    }), [
        updateDeployFiles,
        searchDeployFiles,
        getAllDeployableFiles,
        clearSearchResult,
        applyChangedFiles,
        setStateSearchResult,
        analyzeReferenceChain,
        clearDeployFiles,
        loadFavorites,
        saveFavorite,
        overwriteFavorite,
        applyFavorite,
        deleteFavorite,
    ]);

    // project
    const applyProjectSettings = useCallback((options: ProjectSettingsOptions) => {
        postMessage({ type: 'applyProjectSettings', options });
    }, []);
    const setupHomeSettings = useCallback(() => {
        postMessage({ type: 'setupHomeSettings' });
    }, []);

    const project = useMemo(() => ({
        applyProjectSettings,
        setupHomeSettings,
    }), [applyProjectSettings, setupHomeSettings]);

    // uxStudio
    const uxInit = useCallback(() => { postMessage({ type: 'uxStudioInit' }); }, []);
    const uxApplySettings = useCallback((config: import('../types').UxStudioEnvConfig) => {
        postMessage({ type: 'uxStudioApplySettings', config } as any);
    }, []);
    const uxSearchXfdl = useCallback(() => { postMessage({ type: 'uxStudioSearchXfdl' }); }, []);
    const uxConfirmFiles = useCallback((selectedFiles: string[]) => {
        postMessage({ type: 'uxStudioConfirmFiles', selectedFiles } as any);
    }, []);
    const uxClearConfirmError = useCallback(() => {
        setUxConfirmErrorFiles([]);
    }, [setUxConfirmErrorFiles]);
    const uxLaunchXprj = useCallback((filePath: string) => {
        postMessage({ type: 'uxStudioLaunchXprj', filePath } as any);
    }, []);
    const uxResetSetup = useCallback(() => {
        setUxStudioStatus(null);
        postMessage({ type: 'uxStudioResetSetup' });
    }, [setUxStudioStatus]);

    const uxStudio = useMemo(() => ({
        init: uxInit,
        applySettings: uxApplySettings,
        searchXfdl: uxSearchXfdl,
        confirmFiles: uxConfirmFiles,
        clearConfirmError: uxClearConfirmError,
        launchXprj: uxLaunchXprj,
        resetSetup: uxResetSetup,
    }), [uxInit, uxApplySettings, uxSearchXfdl, uxConfirmFiles, uxClearConfirmError, uxLaunchXprj, uxResetSetup]);

    return useMemo(() => ({
        navigation,
        settings,
        build,
        tomcat,
        deploy,
        project,
        uxStudio,
    }), [navigation, settings, build, tomcat, deploy, project, uxStudio]);
}
