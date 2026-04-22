import { useCallback } from 'react';
import { postMessage } from '../vscode';
import { WebviewMessage } from '../../../src/types/webviewMessage';
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

    function sendMessage(msg: WebviewMessage) {
        postMessage(msg);
    }

    const navigation = {
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
    };

    const settings = {
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
    };

    const build = {
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
    };

    const tomcat = {
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
    };

    const deploy = {
        updateDeployFiles: useCallback((deployFileList: { java: string[], query: string[] }, targetFile: string, fileType: string, changeType: string) => {
            setDeployFileList(deployFileList);
            postMessage({ type: 'updateDeployFiles', deployFileList: deployFileList, targetFile: targetFile, fileType: fileType, changeType: changeType });
        }, []),
        searchDeployFiles: useCallback((keyword: string) => {
            sendMessage({ type: 'searchDeployFiles', keyword });
        }, []),
        ensureDeployFileIndex: useCallback(() => {
            sendMessage({ type: 'ensureDeployFileIndex' });
        }, []),
        refreshDeployFileIndex: useCallback(() => {
            sendMessage({ type: 'refreshDeployFileIndex' });
        }, []),
        getAllDeployableFiles: useCallback(() => {
            sendMessage({ type: 'ensureDeployFileIndex' });
        }, []),
        clearSearchResult: useCallback(() => {
            setSearchResult([]);
        }, [setSearchResult]),
        applyChangedFiles: useCallback(() => {
            setChangedFiles({ java: [], query: [] });
            sendMessage({ type: 'applyChangedFiles' });
        }, []),
        setStateSearchResult: useCallback((searchResult: string[]) => {
            setSearchResult(searchResult);
        }, [setSearchResult]),
        analyzeReferenceChain: useCallback((javaFiles: string[]) => {
            sendMessage({ type: 'analyzeReferenceChain', javaFiles });
        }, []),
        clearDeployFiles: useCallback(() => {
            setDeployFileList({ java: [], query: [] });
            sendMessage({ type: 'clearDeployFiles' });
        }, [setDeployFileList]),
        // 즐겨찾기 관련 액션
        loadFavorites: useCallback(() => {
            sendMessage({ type: 'loadFavorites' });
        }, []),
        saveFavorite: useCallback((name: string, java: string[], query: string[]) => {
            sendMessage({ type: 'saveFavorite', name, java, query });
        }, []),
        overwriteFavorite: useCallback((id: string, java: string[], query: string[]) => {
            sendMessage({ type: 'overwriteFavorite', id, java, query });
        }, []),
        applyFavorite: useCallback((id: string) => {
            sendMessage({ type: 'applyFavorite', id });
        }, []),
        deleteFavorite: useCallback((id: string) => {
            sendMessage({ type: 'deleteFavorite', id });
        }, []),
    };

    const project = {
        applyProjectSettings: useCallback((options: ProjectSettingsOptions) => {
            postMessage({ type: 'applyProjectSettings', options });
        }, []),
        setupHomeSettings: useCallback(() => {
            postMessage({ type: 'setupHomeSettings' });
        }, []),
    };

    const uxStudio = {
        init: useCallback(() => {
            postMessage({ type: 'uxStudioInit' });
        }, []),
        applySettings: useCallback((config: import('../types').UxStudioEnvConfig) => {
            sendMessage({ type: 'uxStudioApplySettings', config });
        }, []),
        searchXfdl: useCallback(() => {
            postMessage({ type: 'uxStudioSearchXfdl' });
        }, []),
        confirmFiles: useCallback((selectedFiles: string[]) => {
            sendMessage({ type: 'uxStudioConfirmFiles', selectedFiles });
        }, []),
        clearConfirmError: useCallback(() => {
            setUxConfirmErrorFiles([]);
        }, [setUxConfirmErrorFiles]),
        launchXprj: useCallback((filePath: string) => {
            sendMessage({ type: 'uxStudioLaunchXprj', filePath });
        }, []),
        resetSetup: useCallback(() => {
            setUxStudioStatus(null); // 로칼 상태 먼저 전환
            postMessage({ type: 'uxStudioResetSetup' });
        }, [setUxStudioStatus]),
    };

    return {
        navigation,
        settings,
        build,
        tomcat,
        deploy,
        project,
        uxStudio,
    };
}
