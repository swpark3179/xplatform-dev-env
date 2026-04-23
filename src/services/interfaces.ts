import type { DeployFileIndexUpdate, TomcatDeployMode } from '../types';

export interface IDeployService {
  startFileWatcher(cb: (msg: any) => void): void;
  stopFileWatcher(): void;
  ensureDeployFileIndex(): void;
  refreshDeployFileIndex(): void;
  searchDeployFiles(keyword: string): Promise<string[]>;
  getAllDeployableFiles(): Promise<string[]>;
  updateDeployList(deployFileList: any, targetFile: string, fileType: string, changeType: string): void;
  applyChangedFiles(): Promise<void>;
  analyzeReferenceChain(javaFiles: string[]): Promise<void>;
  clearDeployFiles(): void;
  loadFavorites(): Promise<any[]>;
  saveFavorite(name: string, java: any, query: any): any;
  overwriteFavorite(id: string, java: any, query: any): any;
  applyFavorite(id: string): any;
  deleteFavorite(id: string): void;
  loadDeploySettings(): void;
  addDeployListFromEditor(filePath: string): void;
  setOnDeployListChanged(cb: (uri: any) => void): void;
  setOnDeployFileIndexChanged(cb: (update: DeployFileIndexUpdate) => void): void;
}

export interface ITomcatService {
  startTomcat(enableHotswap: boolean, onReady: () => void, beforeDeploy: () => Promise<any>): void;
  debugTomcat(enableHotswap: boolean, onReady: () => void, beforeDeploy: () => Promise<any>): Promise<void>;
  stopTomcat(): Promise<void>;
  isDeveloperMode: boolean;
  killTomcatProcess(): void;
  killProcessesOnTomcatPorts(): void;
  areTomcatPortsInUse(): boolean;
}

export interface IGradleService {
  buildClasses(): void;
  cleanProject(): void;
  stopGradle(): void;
  buildClassesWithCallback(cb: (success: boolean) => void): Promise<void>;
  setOnProcessComplete(cb: () => void): void;
}
