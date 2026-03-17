import { useCallback } from 'react';
import { postMessage } from '../vscode';
import type { ProjectSettingsOptions, TomcatDeployMode } from '../types';

export type PageKind = 'settings' | 'main' | 'project-settings';

export interface UseAppActionsDeps {
    setCurrentPage: (page: PageKind) => void;
    setIsGradleRunning: (value: boolean) => void;
    setSearchResult: (value: string[] | ((prev: string[]) => string[])) => void;
    setDeployFileList: (value: { java: string[], query: string[] }) => void;
    setTomcatIsHotReloading: (value: boolean) => void;
    setChangedFiles: (value: { java: string[], query: string[] }) => void;
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
    } = deps;

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
            postMessage({ type: 'searchDeployFiles', keyword } as any);
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
    };

    const project = {
        applyProjectSettings: useCallback((options: ProjectSettingsOptions) => {
            postMessage({ type: 'applyProjectSettings', options });
        }, []),
        setupHomeSettings: useCallback(() => {
            postMessage({ type: 'setupHomeSettings' });
        }, []),
    };

    return {
        navigation,
        settings,
        build,
        tomcat,
        deploy,
        project,
    };
}
