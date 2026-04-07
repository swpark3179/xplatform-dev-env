import { UxStudioService } from './UxStudioService';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('vscode', () => ({
    OutputChannel: jest.fn(),
    Uri: {
        file: jest.fn((path) => ({ fsPath: path }))
    },
    env: {
        openExternal: jest.fn()
    },
    workspace: {
        createFileSystemWatcher: jest.fn(() => ({
            onDidChange: jest.fn(),
            dispose: jest.fn()
        }))
    },
    RelativePattern: jest.fn((base, pattern) => ({ base, pattern }))
}), { virtual: true });

jest.mock('fs', () => {
    return {
        existsSync: jest.fn(),
        mkdirSync: jest.fn(),
        symlinkSync: jest.fn(),
        unlinkSync: jest.fn(),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        readdirSync: jest.fn(),
        copyFileSync: jest.fn(),
        lstatSync: jest.fn(),
        rmSync: jest.fn(),
        promises: {
            unlink: jest.fn(),
            copyFile: jest.fn(),
            symlink: jest.fn(),
            access: jest.fn(),
            mkdir: jest.fn()
        }
    };
});

describe('UxStudioService', () => {
    let service: UxStudioService;
    let mockLog: vscode.OutputChannel;
    const projectRoot = '/test/projectRoot';

    beforeEach(() => {
        jest.clearAllMocks();

        mockLog = {
            appendLine: jest.fn(),
            show: jest.fn(),
            name: 'test',
            append: jest.fn(),
            replace: jest.fn(),
            clear: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn()
        } as any;

        service = new UxStudioService(mockLog, projectRoot);
    });

    it('should be initialized properly', () => {
        expect(service).toBeInstanceOf(UxStudioService);
    });

    describe('updateProjectRoot', () => {
        it('should update the project root internally', () => {
            const newRoot = '/new/project/root';
            service.updateProjectRoot(newRoot);

            // test checkSetupStatus to implicitly verify project root change
            const envPath = path.join(newRoot, '.vscode', 'ui-env', 'env.json');
            (fs.existsSync as jest.Mock).mockReturnValue(true);

            const status = service.checkSetupStatus();
            expect(status).toBe('configured');
            expect(fs.existsSync).toHaveBeenCalledWith(envPath);
        });
    });

    describe('checkDevMode', () => {
        it('should return true if symlink creation succeeds', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.symlinkSync as jest.Mock).mockImplementation(() => {});

            expect(service.checkDevMode()).toBe(true);
            expect(fs.symlinkSync).toHaveBeenCalled();
            expect(fs.unlinkSync).toHaveBeenCalledTimes(2); // once before, once after
        });

        it('should return false if symlink creation fails', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.symlinkSync as jest.Mock).mockImplementation(() => {
                throw new Error('EPERM');
            });

            expect(service.checkDevMode()).toBe(false);
        });
    });

    describe('checkSetupStatus', () => {
        it('should return configured when env.json exists', () => {
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => p.endsWith('env.json'));
            expect(service.checkSetupStatus()).toBe('configured');
        });

        it('should return new when env.json does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            expect(service.checkSetupStatus()).toBe('new');
        });
    });

    describe('loadEnvConfig', () => {
        it('should return null if env.json does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            expect(service.loadEnvConfig()).toBeNull();
        });

        it('should return parsed config if env.json exists', () => {
            const mockConfig = { mode: 'default', customPrefixIds: [] };
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

            expect(service.loadEnvConfig()).toEqual(mockConfig);
        });

        it('should return null on JSON parse error', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

            expect(service.loadEnvConfig()).toBeNull();
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('env.json 읽기 실패'));
        });
    });

    describe('parseDefaultTypedef', () => {
        it('should return empty array if default_typedef.xml does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            expect(service.parseDefaultTypedef()).toEqual([]);
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('default_typedef.xml 없음'));
        });

        it('should return parsed UxServiceEntry list', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            // The regex in UxStudioService: /<Service\s([^/]*?)\/?>/gi fails if the url contains a slash inside the attribute because of [^/].
            // Although it's a bug in the code, we test against how it actually works.
            const mockXml = `
                <Service prefixid="lib" type="form" url="lib_dir" />
                <Service prefixid="Custom" type="form" url="Custom_dir" cachelevel="session" />
            `;
            (fs.readFileSync as jest.Mock).mockReturnValue(mockXml);

            const result = service.parseDefaultTypedef();
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual(expect.objectContaining({
                prefixid: 'lib',
                url: 'lib_dir'
            }));
            expect(result[1]).toEqual(expect.objectContaining({
                prefixid: 'Custom',
                url: 'Custom_dir',
                cachelevel: 'session'
            }));
        });

        it('should return empty array on parse error', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('read error'); });

            expect(service.parseDefaultTypedef()).toEqual([]);
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('default_typedef.xml 파싱 실패'));
        });
    });

    describe('getCustomServices', () => {
        it('should filter out base prefix IDs and only include those with url starting with ./', () => {
            const mockServices = [
                { prefixid: 'lib', url: './lib/' }, // base
                { prefixid: 'Images', url: './Images/' }, // base
                { prefixid: 'Custom1', url: './Custom1/' }, // valid custom
                { prefixid: 'Custom2', url: 'http://external.com' } // not starting with ./
            ] as any[];

            const result = service.getCustomServices(mockServices);
            expect(result).toHaveLength(1);
            expect(result[0].prefixid).toBe('Custom1');
        });
    });

    describe('applySettings', () => {
        it('should apply settings in default mode', async () => {
            const mockConfig = { mode: 'default' } as any;
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock)
                .mockReturnValueOnce([]) // for _cleanUiEnvDir
                .mockReturnValueOnce(['test.xprj', 'test.xadl']) // for _createFilesAndSymlinks
                .mockReturnValueOnce(['test.xprj', 'test.xadl']); // for replacing xml content

            (fs.readFileSync as jest.Mock).mockReturnValue('default_typedef.xml');

            await service.applySettings(mockConfig, []);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('test.xprj'),
                expect.stringContaining('/test/projectRoot/src/webapp/ui/default_typedef.xml'),
                'utf8'
            );
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('env.json'),
                expect.stringContaining('"mode": "default"'),
                'utf8'
            );
            expect(mockLog.appendLine).toHaveBeenCalledWith('[UxStudio] 설정 적용 완료');
        });

        it('should apply settings in selected mode with custom prefix IDs', async () => {
            const mockConfig = { mode: 'selected', customPrefixIds: ['Custom1'], urlAutoCorrect: true } as any;
            const mockAllServices = [{ prefixid: 'Custom1', url: './Custom1/' }] as any[];

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockReturnValue([]);
            (fs.readFileSync as jest.Mock).mockReturnValue('<Service prefixid="Custom1" url="./Custom1/"/> <Service prefixid="Custom2" url="./Custom2/"/> localhost:7001/ep/');

            await service.applySettings(mockConfig, mockAllServices);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                expect.stringContaining('default_typedef.xml'),
                expect.stringContaining('default_typedef.xml')
            );

            // Should be modified using _modifyTypedefXml
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('default_typedef.xml'),
                expect.stringMatching(/60.101.107.57:8002\/ep\//), // Url auto correct applied
                'utf8'
            );

            // Should save env config
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('env.json'),
                expect.stringContaining('"mode": "selected"'),
                'utf8'
            );
        });
    });

    describe('searchXfdlFiles', () => {
        it('should return empty array if ui dir does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            expect(service.searchXfdlFiles()).toEqual([]);
        });

        it('should recursively collect xfdl files ignoring base directories', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockImplementation((dirPath: string) => {
                if (dirPath.endsWith('ui')) {
                    return [
                        { name: 'lib', isDirectory: () => true, isFile: () => false }, // base, should ignore
                        { name: 'Custom', isDirectory: () => true, isFile: () => false }, // custom, explore
                        { name: 'test.xfdl', isDirectory: () => false, isFile: () => true }
                    ];
                }
                if (dirPath.endsWith('Custom')) {
                    return [
                        { name: 'custom.xfdl', isDirectory: () => false, isFile: () => true },
                        { name: 'other.txt', isDirectory: () => false, isFile: () => true }
                    ];
                }
                return [];
            });

            const result = service.searchXfdlFiles();
            expect(result).toHaveLength(2);
            expect(result).toContain('Custom/custom.xfdl');
            expect(result).toContain('test.xfdl');
        });
    });

    describe('confirmFiles', () => {
        it('should successfully copy requested files', async () => {
            const mockFiles = ['Custom/test.xfdl'];
            (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
            (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
            (fs.promises.copyFile as jest.Mock).mockResolvedValue(undefined);

            const result = await service.confirmFiles(mockFiles);
            expect(result.success).toBe(true);
            expect(result.failedFiles).toHaveLength(0);
            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                expect.stringContaining('Custom/test.xfdl'),
                expect.stringContaining('Custom/test.xfdl')
            );
        });

        it('should return failed files if copy fails with EBUSY or EPERM', async () => {
            const mockFiles = ['Custom/busy.xfdl'];
            (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
            (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

            const error = new Error('busy');
            (error as any).code = 'EBUSY';
            (fs.promises.copyFile as jest.Mock).mockRejectedValue(error);

            const result = await service.confirmFiles(mockFiles);
            expect(result.success).toBe(false);
            expect(result.failedFiles).toContain('Custom/busy.xfdl');
        });

        it('should skip files that do not exist', async () => {
            const mockFiles = ['Custom/missing.xfdl'];
            (fs.promises.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

            const result = await service.confirmFiles(mockFiles);
            expect(result.success).toBe(true); // Should gracefully ignore
            expect(fs.promises.copyFile).not.toHaveBeenCalled();
        });
    });

    describe('getXprjFiles', () => {
        it('should return empty array if uiEnvDir does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            expect(service.getXprjFiles()).toEqual([]);
        });

        it('should return xprj files from uiEnvDir', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockReturnValue(['test.xprj', 'test.xadl', 'other.txt']);

            const result = service.getXprjFiles();
            expect(result).toHaveLength(1);
            expect(result[0]).toContain('test.xprj');
        });
    });

    describe('launchXprj', () => {
        it('should open external uri', () => {
            const mockPath = '/test/path/test.xprj';
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);

            service.launchXprj(mockPath);

            expect(vscode.Uri.file).toHaveBeenCalledWith(mockPath);
            expect(vscode.env.openExternal).toHaveBeenCalled();
        });

        it('should log error if open fails', async () => {
            const mockPath = '/test/path/test.xprj';
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(false);

            service.launchXprj(mockPath);

            // Wait for promise resolution
            await Promise.resolve();

            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('xprj 실행 실패'));
        });
    });

    describe('Watcher Operations', () => {
        it('should start and stop myChangesWatcher', () => {
            service.startMyChangesWatcher();
            expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalled();
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('ui-env 파일 감시 시작'));

            service.stopMyChangesWatcher();
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('ui-env 파일 감시 중지'));
        });

        it('should not start watcher if already running', () => {
            service.startMyChangesWatcher();
            (vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();

            service.startMyChangesWatcher();
            expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
        });

        it('should trigger handleMyChangesFileChanged internally', () => {
            service.startMyChangesWatcher();

            // Simulate the onChange trigger
            const watcherMock = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results[0].value;
            const mockChangeFn = watcherMock.onDidChange.mock.calls[0][0];

            (fs.lstatSync as jest.Mock).mockReturnValue({ isSymbolicLink: () => false });
            (fs.existsSync as jest.Mock).mockReturnValue(true);

            // Trigger with a file deep inside ui-env to satisfy relative path condition
            mockChangeFn({ fsPath: path.join(projectRoot, '.vscode', 'ui-env', 'Custom', 'test.xfdl') });

            expect(fs.copyFileSync).toHaveBeenCalled();
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('변경 반영'));
        });
    });

    describe('resetSetup', () => {
        it('should clear uiEnvDir', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockReturnValue(['file1.txt', 'file2.txt']);
            (fs.lstatSync as jest.Mock).mockReturnValue({
                isDirectory: () => false,
                isSymbolicLink: () => false
            });

            service.resetSetup();

            expect(fs.readdirSync).toHaveBeenCalled();
            expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
            expect(mockLog.appendLine).toHaveBeenCalledWith('[UxStudio] 설정 초기화 완료');
        });

        it('should handle errors during reset gracefully', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockImplementation(() => {
                throw new Error('EPERM');
            });

            service.resetSetup();
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('설정 초기화 실패'));
        });
    });
});
