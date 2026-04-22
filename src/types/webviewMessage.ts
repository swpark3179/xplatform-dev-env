export type WebviewMessage =
  | { type: 'searchDeployFiles'; keyword: string }
  | { type: 'getAllDeployableFiles' }
  | { type: 'applyChangedFiles' }
  | { type: 'analyzeReferenceChain'; javaFiles: string[] }
  | { type: 'clearDeployFiles' }
  | { type: 'loadFavorites' }
  | { type: 'saveFavorite'; name: string; java: string[]; query: string[] }
  | { type: 'overwriteFavorite'; id: string; java: string[]; query: string[] }
  | { type: 'applyFavorite'; id: string }
  | { type: 'deleteFavorite'; id: string }
  | { type: 'uxStudioApplySettings'; config: import('../types').UxStudioEnvConfig }
  | { type: 'uxStudioConfirmFiles'; selectedFiles: string[] }
  | { type: 'uxStudioLaunchXprj'; filePath: string }
  // legacy messages (gradual typing)
  | { type: 'initProject' }
  | { type: 'initGlobalSettings' }
  | { type: 'selectFolder'; target: string; currentPath?: string }
  | { type: 'validateAll' }
  | { type: 'buildClasses' }
  | { type: 'cleanProject' }
  | { type: 'stopGradle' }
  | { type: 'initTomcat'; contextRoot: string; profile: string; isBatch: boolean; deployMode: import('../types').TomcatDeployMode }
  | { type: 'startTomcat'; enableHotswap: boolean }
  | { type: 'debugTomcat'; enableHotswap: boolean }
  | { type: 'stopTomcat' }
  | { type: 'killTomcatPorts' }
  | { type: 'applyProjectSettings'; options: import('../types').ProjectSettingsOptions }
  | { type: 'setupHomeSettings' }
  | { type: 'updateDeployFiles'; deployFileList: { java: string[]; query: string[] }; targetFile: string; fileType: string; changeType: string }
  | { type: 'uxStudioInit' }
  | { type: 'uxStudioSearchXfdl' }
  | { type: 'uxStudioResetSetup' };
