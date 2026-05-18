import * as vscode from 'vscode';
import { SettingsService, ValidationService, TomcatService, GradleService, ProjectService, GitIgnoreService } from '../services';
import { TomcatInitService } from './TomcatInitService';
import { DeployService } from './DeployService';
import { UxStudioService } from './UxStudioService';
import type { IDeployService, ITomcatService, IGradleService } from './interfaces';
import type { ChangedFiles, DeployFileList, Settings, TomcatState, ValidationState } from '../types';

export interface ServicesBundle {
  settingsService: SettingsService;
  validationService: ValidationService;
  gradleService: IGradleService;
  tomcatService: ITomcatService;
  tomcatInitService: TomcatInitService;
  deployService: IDeployService;
  projectService: ProjectService;
  uxStudioService: UxStudioService;
  gitIgnoreService: GitIgnoreService;
}

export function createServices(
  log: vscode.OutputChannel,
  extensionUri: vscode.Uri,
  settings: Settings,
  validation: ValidationState,
  tomcatState: TomcatState,
  deployFileList: DeployFileList,
  changedFiles: ChangedFiles,
  fileWatchers: vscode.FileSystemWatcher[]
): ServicesBundle {
  const settingsService = new SettingsService(log, settings);
  const validationService = new ValidationService(log, validation);
  const gradleService: IGradleService = new GradleService(log, settings, () => {});
  const tomcatService: ITomcatService = new TomcatService(log, settings, tomcatState, extensionUri, () => {});
  const tomcatInitService = new TomcatInitService(log, settings, tomcatState, extensionUri, deployFileList);
  const projectService = new ProjectService(log, settings, extensionUri);
  const deployService: IDeployService = new DeployService(log, settings, deployFileList, changedFiles, fileWatchers, tomcatState, gradleService, tomcatService);
  const uxStudioService = new UxStudioService(log, settings.projectRoot);
  const gitIgnoreService = new GitIgnoreService(log, settings);

  tomcatInitService.setDeployService(deployService as any);
  tomcatInitService.setTomcatService(tomcatService);

  return {
    settingsService,
    validationService,
    gradleService,
    tomcatService,
    tomcatInitService,
    deployService,
    projectService,
    uxStudioService,
    gitIgnoreService,
  };
}
