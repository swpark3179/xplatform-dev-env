import type { TomcatDeployMode } from '../types';

export interface IDeployService {
  startFileWatcher(cb: (msg: any) => void): void;
  stopFileWatcher(): void;
}

export interface ITomcatService {
  startTomcat(enableHotswap: boolean, onReady: () => void, beforeDeploy: () => Promise<any>): void;
  debugTomcat(enableHotswap: boolean, onReady: () => void, beforeDeploy: () => Promise<any>): Promise<void>;
  stopTomcat(): Promise<void>;
  isDeveloperMode: boolean;
}

export interface IGradleService {
  buildClasses(): void;
  cleanProject(): void;
  stopGradle(): void;
  buildClassesWithCallback(cb: (success: boolean) => void): Promise<void>;
}
