import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';
import type { Settings } from '../../types';

describe('SettingsService', () => {
    let settingsService: any;
    let mockLog: any;
    let mockSettings: Settings;
    let mockVscode: any;
    let mockFs: any;
    let SettingsServiceClass: any;
    let originalConsoleError: any;

    beforeEach(() => {
        originalConsoleError = console.error;
        console.error = sinon.spy(); // Silence console.error for tests

        mockLog = {
            appendLine: sinon.spy()
        };
        mockSettings = {
            projectRoot: '/test/root',
            gradlePath: '/test/gradle',
            jdkPath: '/test/jdk',
            tomcatPath: '/test/tomcat'
        };

        mockVscode = {
            window: {
                showOpenDialog: sinon.stub(),
                showInformationMessage: sinon.stub(),
                showErrorMessage: sinon.stub()
            },
            workspace: {
                getConfiguration: sinon.stub()
            },
            ConfigurationTarget: {
                Global: 1,
                Workspace: 2
            },
            Uri: {
                file: (path: string) => ({ fsPath: path })
            },
            extensions: {
                getExtension: sinon.stub()
            },
            '@noCallThru': true
        };

        mockFs = {
            existsSync: sinon.stub(),
            '@noCallThru': true
        };

        const module = proxyquire('../SettingsService', {
            'vscode': mockVscode,
            'fs': mockFs
        });

        SettingsServiceClass = module.SettingsService;
        settingsService = new SettingsServiceClass(mockLog, mockSettings);
    });

    afterEach(() => {
        console.error = originalConsoleError;
    });

    describe('getters and basic setters', () => {
        it('should return a copy of settings', () => {
            const settings = settingsService.settings;
            expect(settings).to.deep.equal(mockSettings);
            // Ensure it's a copy
            settings.gradlePath = '/new/gradle';
            expect(settingsService.settings.gradlePath).to.equal('/test/gradle');
        });

        it('should return project root', () => {
            expect(settingsService.projectRoot).to.equal('/test/root');
        });

        it('should set path correctly', () => {
            settingsService.setPath('gradle', '/new/gradle');
            expect(settingsService.settings.gradlePath).to.equal('/new/gradle');

            settingsService.setPath('jdk', '/new/jdk');
            expect(settingsService.settings.jdkPath).to.equal('/new/jdk');

            settingsService.setPath('tomcat', '/new/tomcat');
            expect(settingsService.settings.tomcatPath).to.equal('/new/tomcat');
        });
    });

    describe('handleSelectFolder', () => {
        it('should set path when a folder is selected', async () => {
            const onUpdate = sinon.spy();
            mockVscode.window.showOpenDialog.resolves([{ fsPath: '/selected/path' }]);

            await settingsService.handleSelectFolder(onUpdate, 'gradle');

            expect(mockVscode.window.showOpenDialog.calledOnce).to.be.true;
            expect(settingsService.settings.gradlePath).to.equal('/selected/path');
            expect(onUpdate.calledOnce).to.be.true;
        });

        it('should handle defaultUri correctly when currentPath exists', async () => {
            const onUpdate = sinon.spy();
            mockFs.existsSync.withArgs('/current/path').returns(true);
            mockVscode.window.showOpenDialog.resolves([{ fsPath: '/selected/path' }]);

            await settingsService.handleSelectFolder(onUpdate, 'gradle', '/current/path');

            expect(mockVscode.window.showOpenDialog.calledOnce).to.be.true;
            const args = mockVscode.window.showOpenDialog.firstCall.args[0];
            expect(args.defaultUri).to.deep.equal({ fsPath: '/current/path' });
        });

        it('should not do anything if dialog is cancelled', async () => {
            const onUpdate = sinon.spy();
            mockVscode.window.showOpenDialog.resolves(undefined);

            await settingsService.handleSelectFolder(onUpdate, 'gradle');

            expect(settingsService.settings.gradlePath).to.equal('/test/gradle'); // Unchanged
            expect(onUpdate.called).to.be.false;
        });
    });

    describe('loadSavedSettings', () => {
        it('should load saved settings successfully if all exist', () => {
            const mockConfig = {
                get: sinon.stub()
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            mockConfig.get.withArgs('shiDevHelper.jdkPath').returns('/saved/jdk');
            mockConfig.get.withArgs('shiDevHelper.tomcatPath').returns('/saved/tomcat');
            mockConfig.get.withArgs('shiDevHelper.gradlePath').returns('/saved/gradle');

            mockFs.existsSync.returns(true);

            const result = settingsService.loadSavedSettings();

            expect(result).to.be.true;
            expect(settingsService.settings.jdkPath).to.equal('/saved/jdk');
            expect(settingsService.settings.tomcatPath).to.equal('/saved/tomcat');
            expect(settingsService.settings.gradlePath).to.equal('/saved/gradle');
        });

        it('should return false if some paths do not exist', () => {
            const mockConfig = {
                get: sinon.stub()
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            mockConfig.get.withArgs('shiDevHelper.jdkPath').returns('/saved/jdk');
            mockConfig.get.withArgs('shiDevHelper.tomcatPath').returns('/saved/tomcat');
            mockConfig.get.withArgs('shiDevHelper.gradlePath').returns('/saved/gradle');

            mockFs.existsSync.withArgs('/saved/jdk').returns(true);
            mockFs.existsSync.withArgs('/saved/tomcat').returns(false); // Missing
            mockFs.existsSync.withArgs('/saved/gradle').returns(true);

            const result = settingsService.loadSavedSettings();

            expect(result).to.be.false;
        });

        it('should handle errors during loading', () => {
            const mockConfig = {
                get: sinon.stub().throws(new Error('Config error'))
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            const result = settingsService.loadSavedSettings();

            expect(result).to.be.false;
            expect(mockLog.appendLine.calledWithMatch(/\[settings.json\] 설정 로드 실패/)).to.be.true;
        });
    });

    describe('saveSettings', () => {
        it('should save settings successfully', () => {
            const mockConfig = {
                update: sinon.stub().resolves(),
                inspect: sinon.stub().returns({ workspaceValue: undefined })
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            settingsService.saveSettings();

            expect(mockVscode.workspace.getConfiguration.calledWith('shiDevHelper')).to.be.true;
            expect(mockConfig.update.calledWith('gradlePath', '/test/gradle', 1)).to.be.true;
            expect(mockConfig.update.calledWith('jdkPath', '/test/jdk', 1)).to.be.true;
            expect(mockConfig.update.calledWith('tomcatPath', '/test/tomcat', 1)).to.be.true;
            expect(mockLog.appendLine.calledWith('설정 저장 완료')).to.be.true;
        });

        it('should clear workspace value if it exists', () => {
            const mockConfig = {
                update: sinon.stub().resolves(),
                inspect: sinon.stub().returns({ workspaceValue: 'old-value' })
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            settingsService.saveSettings();

            expect(mockConfig.update.calledWith('gradlePath', undefined, 2)).to.be.true;
            expect(mockConfig.update.calledWith('jdkPath', undefined, 2)).to.be.true;
            expect(mockConfig.update.calledWith('tomcatPath', undefined, 2)).to.be.true;
        });

        it('should handle errors during saving', () => {
            mockVscode.workspace.getConfiguration.throws(new Error('Save error'));

            settingsService.saveSettings();

            expect(mockVscode.window.showErrorMessage.calledWith('설정 저장 실패')).to.be.true;
        });
    });

    describe('initGlobalSettings', () => {
        it('should initialize settings when user confirms', async () => {
            mockVscode.window.showInformationMessage.resolves('예');
            const mockConfig = {
                update: sinon.stub().resolves(),
                inspect: sinon.stub().returns({ globalValue: { oldEnv: 'oldValue' } })
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);
            mockVscode.extensions.getExtension.returns(true); // Pretend extension is installed

            await settingsService.initGlobalSettings();

            // Should update proxy settings
            expect(mockConfig.update.calledWith('http.proxy', 'http://60.200.254.1:9090', 1)).to.be.true;

            // Should update terminal env
            const envArgs = mockConfig.update.getCalls().find((call: any) => call.args[0] === 'terminal.integrated.env.windows')?.args[1];
            expect(envArgs.oldEnv).to.equal('oldValue');
            expect(envArgs.HTTP_PROXY).to.equal('http://60.200.254.1:9090');

            // Should update private extensions
            expect(mockConfig.update.calledWith('privateExtensions.registries')).to.be.true;

            expect(mockVscode.window.showInformationMessage.calledWith('vscode 전역 설정 초기화 완료')).to.be.true;
        });

        it('should do nothing if user cancels', async () => {
            mockVscode.window.showInformationMessage.resolves('아니오');
            const mockConfig = { update: sinon.stub() };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            await settingsService.initGlobalSettings();

            expect(mockConfig.update.called).to.be.false;
        });

        it('should not register private extensions if not installed', async () => {
            mockVscode.window.showInformationMessage.resolves('예');
            const mockConfig = {
                update: sinon.stub().resolves(),
                inspect: sinon.stub().returns(undefined)
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);
            mockVscode.extensions.getExtension.returns(false); // Extension NOT installed

            await settingsService.initGlobalSettings();

            expect(mockConfig.update.calledWith('privateExtensions.registries')).to.be.false;
        });

        it('should handle errors during initialization', async () => {
            mockVscode.window.showInformationMessage.resolves('예');
            const mockConfig = {
                update: sinon.stub().throws(new Error('Init error')),
                inspect: sinon.stub()
            };
            mockVscode.workspace.getConfiguration.returns(mockConfig);

            await settingsService.initGlobalSettings();

            expect(mockVscode.window.showErrorMessage.calledWithMatch(/vscode 전역 설정 초기화 실패/)).to.be.true;
        });
    });
});
