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

    const navigation = useMemo(() => ({
        goToSettings: useCallback(() => {
            setCurrentPage('settings');
        }, [setCurrentPage]),
        goToMain: useCallback(() => {
            setCurrentPage('main');
        }, [setCurrentPage]),
        goToProjectSettings: useCallback(() => {
            setCurrentPage('project-settings');
        }, [setCurrentPage]),
        goToUxStudio: useCallback(() => {
            setCurrentPage('ux-studio');
        }, [setCurrentPage]),
    }), [setCurrentPage]);

    const settings = useMemo(() => ({
        initProject: useCallback(() => {
            postMessage({ type: 'initProject' });
        }, []),
        initGlobalSettings: useCallback(() => {
            postMessage({ type: 'initGlobalSettings' });
        }, []),
        selectFolder: useCallback((target: string, currentPath?: string) => {
            postMessage({ type: 'selectFolder', target, currentPath });
        }, []),
        validateAll: useCallback(() => {
            postMessage({ type: 'validateAll' });
        }, []),
    }), []);

    const build = useMemo(() => ({
        buildClasses: useCallback(() => {
            setIsGradleRunning(true);
            postMessage({ type: 'buildClasses' });
        }, [setIsGradleRunning]),
        cleanProject: useCallback(() => {
            setIsGradleRunning(true);
            postMessage({ type: 'cleanProject' });
        }, [setIsGradleRunning]),
        stopGradle: useCallback(() => {
            postMessage({ type: 'stopGradle' });
        }, []),
    }), [setIsGradleRunning]);

    const tomcat = useMemo(() => ({
        initTomcat: useCallback((contextRoot: string, profile: string, isBatch: boolean, deployMode: TomcatDeployMode) => {
            postMessage({ type: 'initTomcat', contextRoot, profile, isBatch, deployMode });
        }, []),
        startTomcat: useCallback((enableHotswap: boolean) => {
            postMessage({ type: 'startTomcat', enableHotswap });
        }, []),
        debugTomcat: useCallback((enableHotswap: boolean) => {
            postMessage({ type: 'debugTomcat', enableHotswap });
        }, []),
        stopTomcat: useCallback(() => {
            postMessage({ type: 'stopTomcat' });
        }, []),
        killTomcatPorts: useCallback(() => {
            postMessage({ type: 'killTomcatPorts' });
        }, []),
        setStateIsHotReloading: useCallback((value: boolean) => {
            setTomcatIsHotReloading(value);
        }, [setTomcatIsHotReloading]),
    }), [setTomcatIsHotReloading]);

    const deploy = useMemo(() => ({
        updateDeployFiles: useCallback((deployFileList: { java: string[], query: string[] }, targetFile: string, fileType: string, changeType: string) => {
            setDeployFileList(deployFileList);
            postMessage({ type: 'updateDeployFiles', deployFileList: deployFileList, targetFile: targetFile, fileType: fileType, changeType: changeType });
        }, [setDeployFileList]),
        searchDeployFiles: useCallback((keyword: string) => {
            postMessage({ type: 'searchDeployFiles', keyword } as any);
        }, []),
        getAllDeployableFiles: useCallback(() => {
            postMessage({ type: 'getAllDeployableFiles' } as any);
        }, []),
        clearSearchResult: useCallback(() => {
            setSearchResult([]);
        }, [setSearchResult]),
        applyChangedFiles: useCallback(() => {
            setChangedFiles({ java: [], query: [] });
            postMessage({ type: 'applyChangedFiles' } as any);
        }, []),
        setStateSearchResult: useCallback((searchResult: string[]) => {
            setSearchResult(searchResult);
        }, [setSearchResult]),
        analyzeReferenceChain: useCallback((javaFiles: string[]) => {
            postMessage({ type: 'analyzeReferenceChain', javaFiles } as any);
        }, []),
        clearDeployFiles: useCallback(() => {
            setDeployFileList({ java: [], query: [] });
            postMessage({ type: 'clearDeployFiles' } as any);
        }, [setDeployFileList]),
        // 즐겨찾기 관련 액션
        loadFavorites: useCallback(() => {
            postMessage({ type: 'loadFavorites' } as any);
        }, []),
        saveFavorite: useCallback((name: string, java: string[], query: string[]) => {
            postMessage({ type: 'saveFavorite', name, java, query } as any);
        }, []),
        overwriteFavorite: useCallback((id: string, java: string[], query: string[]) => {
            postMessage({ type: 'overwriteFavorite', id, java, query } as any);
        }, []),
        applyFavorite: useCallback((id: string) => {
            postMessage({ type: 'applyFavorite', id } as any);
        }, []),
        deleteFavorite: useCallback((id: string) => {
            postMessage({ type: 'deleteFavorite', id } as any);
        }, []),
    }), [setDeployFileList, setSearchResult, setChangedFiles]);

    const project = useMemo(() => ({
        applyProjectSettings: useCallback((options: ProjectSettingsOptions) => {
            postMessage({ type: 'applyProjectSettings', options });
        }, []),
        setupHomeSettings: useCallback(() => {
            postMessage({ type: 'setupHomeSettings' });
        }, []),
    }), []);

    const uxStudio = useMemo(() => ({
        init: useCallback(() => {
            postMessage({ type: 'uxStudioInit' });
        }, []),
        applySettings: useCallback((config: import('../types').UxStudioEnvConfig) => {
            postMessage({ type: 'uxStudioApplySettings', config } as any);
        }, []),
        searchXfdl: useCallback(() => {
            postMessage({ type: 'uxStudioSearchXfdl' });
        }, []),
        confirmFiles: useCallback((selectedFiles: string[]) => {
            postMessage({ type: 'uxStudioConfirmFiles', selectedFiles } as any);
        }, []),
        clearConfirmError: useCallback(() => {
            setUxConfirmErrorFiles([]);
        }, [setUxConfirmErrorFiles]),
        launchXprj: useCallback((filePath: string) => {
            postMessage({ type: 'uxStudioLaunchXprj', filePath } as any);
        }, []),
        resetSetup: useCallback(() => {
            setUxStudioStatus(null); // 로칼 상태 먼저 전환
            postMessage({ type: 'uxStudioResetSetup' });
        }, [setUxStudioStatus]),
    }), [setUxConfirmErrorFiles, setUxStudioStatus]);

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
