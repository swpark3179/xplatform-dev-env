import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DeployService } from './DeployService';
import { Settings, DeployFileList, ChangedFiles, TomcatState } from '../types';
import { GradleService } from './GradleService';
import { TomcatService } from './TomcatService';
import { AnalyzeReferenceChain } from './AnalyzeReferenceChain';

jest.mock('vscode', () => {
    const mUri = {
        file: jest.fn((f) => ({ fsPath: f })),
    };
    return {
        window: {
            showErrorMessage: jest.fn(),
            showWarningMessage: jest.fn(),
            withProgress: jest.fn(),
        },
        workspace: {
            findFiles: jest.fn(),
            createFileSystemWatcher: jest.fn(),
        },
        RelativePattern: jest.fn((base, pattern) => ({ base, pattern })),
        Uri: mUri,
        ProgressLocation: {
            Notification: 1,
        },
    };
}, { virtual: true });

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    copyFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    promises: {
        readdir: jest.fn(),
        readFile: jest.fn(),
        mkdir: jest.fn(),
        copyFile: jest.fn(),
    }
}));

jest.mock('crypto', () => ({
    randomUUID: jest.fn(),
}));

jest.mock('./GradleService');
jest.mock('./TomcatService');
jest.mock('./AnalyzeReferenceChain');

describe('DeployService', () => {
    let mockLog: any;
    let mockSettings: Settings;
    let mockDeployFileList: DeployFileList;
    let mockChangedFiles: ChangedFiles;
    let mockFileWatchers: any[];
    let mockTomcatState: TomcatState;
    let mockGradleService: any;
    let mockTomcatService: any;
    let deployService: DeployService;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLog = {
            clear: jest.fn(),
            show: jest.fn(),
            appendLine: jest.fn(),
        };

        mockSettings = {
            projectRoot: '/test/project',
            gradlePath: '/test/gradle',
            jdkPath: '/test/jdk',
            tomcatPath: '/test/tomcat',
        };

        mockDeployFileList = {
            java: [],
            query: [],
        };

        mockChangedFiles = {
            java: [],
            query: [],
        };

        mockFileWatchers = [];

        mockTomcatState = {
            initialized: true,
            contextRoot: '/test',
            running: false,
            debugMode: false,
            portsBlocked: false,
            deployMode: 'default',
            deployPath: '/test/deploy',
            profile: 'local',
            isBatch: false,
            initializing: false,
            starting: false,
            stopping: false,
            isHotReloadMode: false,
        };

        mockGradleService = new GradleService({} as any, {} as any, jest.fn());
        mockTomcatService = {} as any; // We'll just mock the object since we mock the whole module anyway

        deployService = new DeployService(
            mockLog,
            mockSettings,
            mockDeployFileList,
            mockChangedFiles,
            mockFileWatchers,
            mockTomcatState,
            mockGradleService,
            mockTomcatService
        );
    });

    it('should be created successfully', () => {
        expect(deployService).toBeDefined();
    });

    describe('searchDeployFiles', () => {
        it('should return files that are not already in the deploy list', async () => {
            const dirent = (name: string, type: 'file' | 'dir') => ({
                name,
                isDirectory: () => type === 'dir',
                isFile: () => type === 'file',
            });
            const normalize = (targetPath: string) => targetPath.replace(/\\/g, '/');
            (fs.existsSync as jest.Mock).mockImplementation((targetPath: string) => (
                normalize(targetPath) === '/test/project/src/java' || normalize(targetPath) === '/test/project/src/query'
            ));
            (fs.promises.readdir as jest.Mock).mockImplementation((targetPath: string) => {
                if (normalize(targetPath) === '/test/project/src/java') {
                    return Promise.resolve([
                        dirent('Test1.java', 'file'),
                        dirent('Test2.java', 'file'),
                    ]);
                }
                if (normalize(targetPath) === '/test/project/src/query') {
                    return Promise.resolve([dirent('Test1Query.xml', 'file')]);
                }
                return Promise.resolve([]);
            });

            mockDeployFileList.java = ['/test/project/src/java/Test1.java'];

            const result = await deployService.searchDeployFiles('Test');

            expect(result).toEqual([
                '/test/project/src/java/Test2.java',
                '/test/project/src/query/Test1Query.xml'
            ]);
            expect(fs.promises.readdir).toHaveBeenCalledWith(expect.stringMatching(/[\\/]src[\\/]java$/), { withFileTypes: true });
        });
    });

    describe('getAllDeployableFiles', () => {
        it('should return all java and xml files that are not already in the deploy list', async () => {
            const dirent = (name: string, type: 'file' | 'dir') => ({
                name,
                isDirectory: () => type === 'dir',
                isFile: () => type === 'file',
            });
            const normalize = (targetPath: string) => targetPath.replace(/\\/g, '/');
            (fs.existsSync as jest.Mock).mockImplementation((targetPath: string) => (
                normalize(targetPath) === '/test/project/src/java' || normalize(targetPath) === '/test/project/src/query'
            ));
            (fs.promises.readdir as jest.Mock).mockImplementation((targetPath: string) => {
                if (normalize(targetPath) === '/test/project/src/java') {
                    return Promise.resolve([
                        dirent('Test1.java', 'file'),
                        dirent('Test2.java', 'file'),
                        dirent('NotRelated.txt', 'file'),
                    ]);
                }
                if (normalize(targetPath) === '/test/project/src/query') {
                    return Promise.resolve([dirent('Test1Query.xml', 'file')]);
                }
                return Promise.resolve([]);
            });

            mockDeployFileList.java = ['/test/project/src/java/Test1.java'];

            const result = await deployService.getAllDeployableFiles();

            expect(result).toEqual([
                '/test/project/src/java/Test2.java',
                '/test/project/src/query/Test1Query.xml'
            ]);
            expect(fs.promises.readdir).toHaveBeenCalledWith(expect.stringMatching(/[\\/]src[\\/]java$/), { withFileTypes: true });
        });
    });

    describe('updateDeployList', () => {
        it('should show warning and return if tomcat is running', () => {
            mockTomcatState.running = true;

            deployService.updateDeployList({ java: [], query: [] }, '', 'java', 'add');

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('톰캣 실행 중에는 배포대상에 추가/제거할 수 없습니다.');
            expect(mockDeployFileList.java).toEqual([]);
        });

        it('should update list and trigger callback when tomcat is not running', () => {
            const onDeployListChanged = jest.fn();
            deployService.setOnDeployListChanged(onDeployListChanged);

            const newDeployList = {
                java: ['/test/project/src/java/Test.java'],
                query: []
            };

            deployService.updateDeployList(newDeployList, '/test/project/src/java/Test.java', 'java', 'add');

            expect(mockDeployFileList.java).toEqual(newDeployList.java);
            expect(onDeployListChanged).toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/test/project/src/java/Test.java' }));
        });

        it('should save settings and handle autoDetectedAdded', () => {
            deployService.saveDeploySettings = jest.fn();

            deployService.updateDeployList({ java: [], query: [] }, '', 'java', 'add', ['/test/auto.java']);

            expect(deployService.saveDeploySettings).toHaveBeenCalledWith(['/test/auto.java']);
        });
    });

    describe('addDeployListFromEditor', () => {
        it('should show warning and return if tomcat is running', () => {
            mockTomcatState.running = true;

            deployService.addDeployListFromEditor('/test/project/src/java/Test.java');

            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('톰캣 실행 중에는 배포대상에 추가/제거할 수 없습니다.');
            expect(mockDeployFileList.java).toEqual([]);
        });

        it('should toggle java file correctly', () => {
            const onDeployListChanged = jest.fn();
            deployService.setOnDeployListChanged(onDeployListChanged);
            deployService.saveDeploySettings = jest.fn();

            // Add
            deployService.addDeployListFromEditor('/test/project/src/java/Test.java');
            expect(mockDeployFileList.java).toContain('/test/project/src/java/Test.java');
            expect(onDeployListChanged).toHaveBeenCalled();
            expect(deployService.saveDeploySettings).toHaveBeenCalled();

            // Remove
            deployService.addDeployListFromEditor('/test/project/src/java/Test.java');
            expect(mockDeployFileList.java).not.toContain('/test/project/src/java/Test.java');
        });

        it('should toggle query file correctly', () => {
            deployService.saveDeploySettings = jest.fn();

            // Add
            deployService.addDeployListFromEditor('/test/project/src/query/TestQuery.xml');
            expect(mockDeployFileList.query).toContain('/test/project/src/query/TestQuery.xml');

            // Remove
            deployService.addDeployListFromEditor('/test/project/src/query/TestQuery.xml');
            expect(mockDeployFileList.query).not.toContain('/test/project/src/query/TestQuery.xml');
        });
    });
    describe('saveDeploySettings and loadDeploySettings', () => {
        beforeEach(() => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
            (fs.readFileSync as jest.Mock).mockReturnValue('{}');
        });

        it('should save deploy settings correctly with merged autoDetectedAdded', () => {
            mockDeployFileList.java = ['/test/project/src/java/Test.java'];
            mockDeployFileList.query = ['/test/project/src/query/TestQuery.xml'];
            mockTomcatState.profile = 'prod';
            mockTomcatState.isBatch = true;
            mockTomcatState.deployMode = 'selected';

            deployService.saveDeploySettings(['/test/project/src/java/Auto.java']);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('shi-deploy.json'),
                expect.any(String),
                'utf8'
            );

            const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
            const savedData = JSON.parse(writeCall[1]);

            expect(savedData.deployFileList.java).toEqual(['java/Test.java']);
            expect(savedData.deployFileList.query).toEqual(['query/TestQuery.xml']);
            expect(savedData.autoDetectedJava).toContain('java/Auto.java');
            expect(savedData.profile).toBe('prod');
            expect(savedData.isBatch).toBe(true);
            expect(savedData.deployMode).toBe('selected');
        });

        it('should ignore save error gracefully', () => {
            (fs.writeFileSync as jest.Mock).mockImplementation(() => {
                throw new Error('Write error');
            });

            // If an exception is thrown and not caught, this test will fail.
            expect(() => {
                deployService.saveDeploySettings();
            }).not.toThrow();
        });

        it('should load deploy settings correctly', () => {
            const mockData = {
                deployFileList: {
                    java: ['java/Test.java'],
                    query: ['query/TestQuery.xml']
                },
                autoDetectedJava: ['java/Auto.java'],
                profile: 'dev',
                isBatch: false,
                deployMode: 'selected'
            };

            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockData));

            deployService.loadDeploySettings();

            expect(mockDeployFileList.java).toEqual(['/test/project/src/java/Test.java']);
            expect(mockDeployFileList.query).toEqual(['/test/project/src/query/TestQuery.xml']);
            expect(mockTomcatState.profile).toBe('dev');
            expect(mockTomcatState.isBatch).toBe(false);
            expect(mockTomcatState.deployMode).toBe('selected');
            // Testing internal set is difficult, but we know it parsed autoDetectedJava
        });

        it('should do nothing if settings file does not exist when loading', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            deployService.loadDeploySettings();

            expect(fs.readFileSync).not.toHaveBeenCalled();
            expect(mockTomcatState.profile).toBe('local'); // Default value untouched
        });

        it('should ignore load error gracefully', () => {
            (fs.readFileSync as jest.Mock).mockImplementation(() => {
                throw new Error('Read error');
            });

            expect(() => {
                deployService.loadDeploySettings();
            }).not.toThrow();
        });
    });

    describe('clearDeployFiles', () => {
        beforeEach(() => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
        });

        it('should reset autoDetectedJava in saved settings when clearing deploy files', () => {
            mockDeployFileList.java = ['/test/project/src/java/Test.java'];
            mockDeployFileList.query = ['/test/project/src/query/TestQuery.xml'];

            // 자동 탐지 항목을 내부 Set에 적재 (saveDeploySettings(mergeAutoDetected) 경유)
            deployService.saveDeploySettings(['/test/project/src/java/Auto.java']);

            const initialWriteCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
            const initialSavedData = JSON.parse(initialWriteCall[1]);
            expect(initialSavedData.autoDetectedJava).toContain('java/Auto.java');

            // 초기화 수행
            deployService.clearDeployFiles();

            const lastWriteCall = (fs.writeFileSync as jest.Mock).mock.calls[
                (fs.writeFileSync as jest.Mock).mock.calls.length - 1
            ];
            const savedData = JSON.parse(lastWriteCall[1]);

            expect(mockDeployFileList.java).toEqual([]);
            expect(mockDeployFileList.query).toEqual([]);
            expect(savedData.deployFileList.java).toEqual([]);
            expect(savedData.deployFileList.query).toEqual([]);
            expect(savedData.autoDetectedJava).toEqual([]);
        });
    });

    describe('startFileWatcher and stopFileWatcher', () => {
        it('should create file watchers based on mode and clean them up', () => {
            const mockWatcher = {
                onDidChange: jest.fn(),
                onDidCreate: jest.fn(),
                dispose: jest.fn(),
            };
            (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(mockWatcher);

            const postMessage = jest.fn();

            // Developer mode false: includes static files
            mockTomcatService.isDeveloperMode = false;
            deployService.startFileWatcher(postMessage);

            expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(3);

            // Stop
            deployService.stopFileWatcher();
            expect(mockWatcher.dispose).toHaveBeenCalledTimes(3);
        });

        it('should not include static files in developer mode', () => {
            const mockWatcher = {
                onDidChange: jest.fn(),
                onDidCreate: jest.fn(),
                dispose: jest.fn(),
            };
            (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(mockWatcher);

            const postMessage = jest.fn();

            // Developer mode true: excludes static files
            mockTomcatService.isDeveloperMode = true;
            deployService.startFileWatcher(postMessage);

            expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
        });
    });

    describe('applyChangedFiles', () => {
        beforeEach(() => {
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['Test.class', 'Test$1.class']);
            (fs.promises.copyFile as jest.Mock).mockResolvedValue(undefined);
            (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
            (fs.existsSync as jest.Mock).mockReturnValue(true);
        });

        it('should build classes and copy java files', async () => {
            mockChangedFiles.java = ['/test/project/src/java/com/test/Test.java'];
            mockChangedFiles.query = [];

            mockGradleService.buildClassesWithCallback.mockImplementation(async (cb: any) => {
                await cb(true);
            });

            await deployService.applyChangedFiles();

            expect(mockGradleService.buildClassesWithCallback).toHaveBeenCalled();
            expect(fs.promises.copyFile).toHaveBeenCalledTimes(2); // Test.class and Test$1.class
            expect(mockChangedFiles.java).toEqual([]);
        });

        it('should copy query files directly without building', async () => {
            mockChangedFiles.java = [];
            mockChangedFiles.query = ['/test/project/src/query/com/test/TestQuery.xml'];

            await deployService.applyChangedFiles();

            expect(mockGradleService.buildClassesWithCallback).not.toHaveBeenCalled();
            expect(fs.promises.copyFile).toHaveBeenCalledTimes(1);
            expect(mockChangedFiles.query).toEqual([]);
        });

        it('should handle ENOENT error during java class copy gracefully', async () => {
            mockChangedFiles.java = ['/test/project/src/java/com/test/Test.java'];
            mockChangedFiles.query = [];

            mockGradleService.buildClassesWithCallback.mockImplementation(async (cb: any) => {
                await cb(true);
            });

            const error = new Error('ENOENT') as any;
            error.code = 'ENOENT';
            (fs.promises.readdir as jest.Mock).mockRejectedValue(error);

            await expect(deployService.applyChangedFiles()).resolves.not.toThrow();

            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('class 디렉터리 없음'));
        });


        it('should throw error for non-ENOENT error during query copy directly', async () => {
            mockChangedFiles.java = [];
            mockChangedFiles.query = ['/test/project/src/query/com/test/TestQuery.xml'];

            const error = new Error('Other error') as any;
            (fs.promises.mkdir as jest.Mock).mockRejectedValue(error);

            await expect(deployService.applyChangedFiles()).rejects.toThrow('Other error');
        });
    });

    describe('Favorite features', () => {
        beforeEach(() => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.mkdirSync as jest.Mock).mockImplementation(() => {});
            (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
            (fs.readFileSync as jest.Mock).mockReturnValue('{}');
            (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
            (fs.promises.readdir as jest.Mock).mockResolvedValue([]);
            (fs.promises.readFile as jest.Mock).mockResolvedValue('{}');
            (crypto.randomUUID as jest.Mock).mockReturnValue('mocked-uuid');
        });

        it('should save favorite successfully', () => {
            const java = ['/test/project/src/java/Test.java'];
            const query = ['/test/project/src/query/TestQuery.xml'];

            const result = deployService.saveFavorite('My Favorite', java, query);

            expect(result.id).toBe('mocked-uuid');
            expect(result.name).toBe('My Favorite');
            expect(result.java).toEqual(['java/Test.java']);
            expect(result.query).toEqual(['query/TestQuery.xml']);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('mocked-uuid.json'),
                expect.any(String),
                'utf8'
            );
        });

        it('should overwrite favorite successfully', () => {
            const existingFav = {
                id: 'mocked-uuid',
                name: 'Existing',
                java: ['old.java'],
                query: ['old.xml']
            };
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(existingFav));

            const java = ['/test/project/src/java/New.java'];
            const query = ['/test/project/src/query/New.xml'];

            const result = deployService.overwriteFavorite('mocked-uuid', java, query);

            expect(result?.id).toBe('mocked-uuid');
            expect(result?.name).toBe('Existing'); // Name remains
            expect(result?.java).toEqual(['java/New.java']);
            expect(result?.query).toEqual(['query/New.xml']);
        });

        it('should return null when overwriting non-existent favorite', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const result = deployService.overwriteFavorite('mocked-uuid', [], []);

            expect(result).toBeNull();
        });

        it('should apply favorite and update deploy list', () => {
            const favToApply = {
                id: 'mocked-uuid',
                name: 'Existing',
                java: ['java/Test.java'],
                query: ['query/TestQuery.xml']
            };
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(favToApply));
            deployService.saveDeploySettings = jest.fn();

            const result = deployService.applyFavorite('mocked-uuid');

            expect(result).toEqual(favToApply);
            expect(mockDeployFileList.java).toEqual(['/test/project/src/java/Test.java']);
            expect(mockDeployFileList.query).toEqual(['/test/project/src/query/TestQuery.xml']);
            expect(deployService.saveDeploySettings).toHaveBeenCalled();
        });

        it('should return null when applying non-existent favorite', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const result = deployService.applyFavorite('mocked-uuid');

            expect(result).toBeNull();
        });

        it('should delete favorite successfully', () => {
            const result = deployService.deleteFavorite('mocked-uuid');

            expect(result).toBe(true);
            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mocked-uuid.json'));
        });

        it('should return false when deleting non-existent favorite', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const result = deployService.deleteFavorite('mocked-uuid');

            expect(result).toBe(false);
            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });

        it('should load favorites and sort them by name', async () => {
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['fav1.json', 'fav2.json', 'ignored.txt']);
            (fs.promises.readFile as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify({ name: 'B Fav' }))
                .mockResolvedValueOnce(JSON.stringify({ name: 'A Fav' }));

            const results = await deployService.loadFavorites();

            expect(results.length).toBe(2);
            expect(results[0].name).toBe('A Fav');
            expect(results[1].name).toBe('B Fav');
        });

        it('should return empty array if favorites folder does not exist when loading', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const results = await deployService.loadFavorites();

            expect(results).toEqual([]);
            expect(fs.promises.readdir).not.toHaveBeenCalled();
        });
    });
});
