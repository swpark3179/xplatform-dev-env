import { TomcatInitService } from './TomcatInitService';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import cpy from 'cpy';
import { execFileSync } from 'child_process';
import { Settings, TomcatState, DeployFileList } from '../types';
import path from 'path';

// Mock dependencies
jest.mock('vscode', () => ({
    OutputChannel: jest.fn(),
    ProgressLocation: {
        Notification: 15
    },
    Uri: {
        file: jest.fn((path) => ({ fsPath: path }))
    },
    window: {
        showErrorMessage: jest.fn(),
        withProgress: jest.fn().mockImplementation(async (options, task) => {
            const progress = { report: jest.fn() };
            return task(progress);
        })
    }
}), { virtual: true });

jest.mock('fs-extra', () => ({
    pathExistsSync: jest.fn(),
    emptyDirSync: jest.fn(),
    emptyDir: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    ensureDirSync: jest.fn(),
    copy: jest.fn(),
    existsSync: jest.fn(),
    removeSync: jest.fn(),
    symlinkSync: jest.fn(),
    readdirSync: jest.fn(),
    // safeEmptyDir(fsCleanup)에서 사용하는 비동기 함수들
    pathExists: jest.fn().mockResolvedValue(true),
    ensureDir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    lstat: jest.fn().mockResolvedValue({ isSymbolicLink: () => false }),
    remove: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    rmdir: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('cpy', () => jest.fn().mockResolvedValue([]));

jest.mock('child_process', () => ({
    execFileSync: jest.fn()
}));

describe('TomcatInitService', () => {
    let service: TomcatInitService;
    let mockLog: vscode.OutputChannel;
    let mockSettings: Settings;
    let mockTomcatState: TomcatState;
    let mockDeployFileList: DeployFileList;
    let mockExtensionUri: vscode.Uri;
    let mockDeployService: any;

    beforeEach(() => {
        // Reset all mocks
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
        };

        mockSettings = {
            projectRoot: '/test/projectRoot',
            gradlePath: '/test/gradlePath',
            jdkPath: '/test/jdkPath',
            tomcatPath: '/test/tomcatPath'
        };

        mockTomcatState = {
            initialized: false,
            contextRoot: 'testRoot',
            running: false,
            debugMode: false,
            portsBlocked: false,
            deployMode: 'default',
            deployPath: '/test/deployPath',
            profile: 'local',
            isBatch: false,
            initializing: false,
            starting: false,
            stopping: false,
            isHotReloadMode: false
        };

        mockDeployFileList = {
            java: [],
            query: [],
            batch: []
        };

        mockExtensionUri = vscode.Uri.file('/test/extensionPath');

        mockDeployService = {
            saveDeploySettings: jest.fn()
        };

        service = new TomcatInitService(mockLog, mockSettings, mockTomcatState, mockExtensionUri, mockDeployFileList);
        service.setDeployService(mockDeployService as any);
    });

    describe('initTomcat', () => {
        it('should return false if contextRoot is empty', async () => {
            const result = await service.initTomcat('', 'local', false, 'default');
            expect(result).toBe(false);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Context Root가 비어있습니다.');
        });

        it('should successfully initialize tomcat directories and files when .tomcat does not exist', async () => {
            (fs.pathExistsSync as jest.Mock).mockReturnValue(false);

            const result = await service.initTomcat('myRoot', 'dev', true, 'selected');

            expect(result).toBe(true);
            expect(fs.emptyDirSync).toHaveBeenCalled();
            expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/test/projectRoot/.tomcat', 'conf'));
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join('/test/projectRoot/.tomcat', 'conf', 'server.xml'),
                expect.any(String),
                'utf8'
            );
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join('/test/projectRoot/.tomcat', 'conf', 'context.xml'),
                expect.any(String),
                'utf8'
            );
            expect(cpy).toHaveBeenCalledTimes(4);
            expect(mockTomcatState.contextRoot).toBe('myRoot');
            expect(mockTomcatState.profile).toBe('dev');
            expect(mockTomcatState.isBatch).toBe(true);
            expect(mockTomcatState.deployMode).toBe('selected');
            expect(mockDeployService.saveDeploySettings).toHaveBeenCalled();
            expect(mockTomcatState.initialized).toBe(true);
        });

        it('should successfully initialize tomcat and clean existing .tomcat folder', async () => {
            (fs.pathExistsSync as jest.Mock).mockReturnValue(true);
            // 기존 .tomcat 폴더에 항목 2개가 있는 상태 → safeEmptyDir가 각 항목을 제거
            (fs.pathExists as jest.Mock).mockResolvedValue(true);
            (fs.readdir as unknown as jest.Mock).mockResolvedValueOnce(['conf', 'webapps']);

            const result = await service.initTomcat('myRoot', 'local', false, 'default');

            expect(result).toBe(true);
            // cleanFolderSafe는 공용 safeEmptyDir를 통해 .tomcat 내용물을 비운다
            expect(fs.readdir).toHaveBeenCalledWith('/test/projectRoot/.tomcat');
            expect(fs.remove).toHaveBeenCalledTimes(2);
        });

        it('should not follow symlinks/junctions when cleaning (link만 제거)', async () => {
            (fs.pathExistsSync as jest.Mock).mockReturnValue(true);
            (fs.pathExists as jest.Mock).mockResolvedValue(true);
            (fs.readdir as unknown as jest.Mock).mockResolvedValueOnce(['rd']);
            // rd 항목이 심볼릭 링크(junction)인 경우
            (fs.lstat as unknown as jest.Mock).mockResolvedValueOnce({ isSymbolicLink: () => true });

            const result = await service.initTomcat('myRoot', 'local', false, 'default');

            expect(result).toBe(true);
            // 링크는 unlink로만 제거하고, 타깃을 따라가는 remove는 호출하지 않아야 한다
            expect(fs.unlink).toHaveBeenCalledWith(path.join('/test/projectRoot/.tomcat', 'rd'));
            expect(fs.remove).not.toHaveBeenCalled();
        });

        it('should return false if error thrown during initialization', async () => {
            (fs.pathExistsSync as jest.Mock).mockImplementation(() => {
                throw new Error('Some IO error');
            });

            const result = await service.initTomcat('myRoot', 'local', false, 'default');

            expect(result).toBe(false);
            expect(mockLog.appendLine).toHaveBeenCalledWith('Tomcat 초기화 실패: Some IO error');
        });
    });

    describe('deployServiceFiles', () => {
        beforeEach(() => {
            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                // Mock srcClassesPath to exist
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                return false;
            });
            (fs.readFileSync as jest.Mock).mockReturnValue('');
        });

        it('should return false if srcClassesPath does not exist', async () => {
            (fs.pathExistsSync as jest.Mock).mockReturnValue(false);
            const result = await service.deployServiceFiles('myRoot', 'default', false);
            expect(result).toBe(false);
            expect(mockLog.appendLine).toHaveBeenCalledWith(expect.stringContaining('[경고] 빌드된 class 파일을 찾을 수 없습니다'));
        });

        it('should copy all files in default mode', async () => {
            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith(path.join('resources', 'lib'))) return false; // no extension lib
                return false;
            });

            const result = await service.deployServiceFiles('myRoot', 'default', false);

            expect(result).toBe(true);
            expect(cpy).toHaveBeenCalledWith(
                ['**/*', '!**/WEB-INF/lib', '!**/XPLATFORM_Client_License.xml'],
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'src', 'webapp') })
            );
            expect(cpy).toHaveBeenCalledWith(
                '**/*.class*',
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'target', 'classes') })
            );
            expect(mockTomcatState.deployPath).toBe(path.join('/test/projectRoot', '.tomcat', 'webapps', 'myRoot'));
        });

        it('should copy selected files in selected mode', async () => {
            mockDeployFileList = {
                java: ['/src/java/com/test/MyClass.java'],
                query: ['/src/query/myQuery.xml'],
                batch: []
            };
            service = new TomcatInitService(mockLog, mockSettings, mockTomcatState, mockExtensionUri, mockDeployFileList);
            service.setDeployService(mockDeployService as any);

            const result = await service.deployServiceFiles('myRoot', 'selected', false);

            expect(result).toBe(true);
            expect(cpy).toHaveBeenCalledWith(
                expect.arrayContaining(['**/com/test/MyClass*.class*', '**/com/shi/*/*Config*.class*']),
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'target', 'classes') })
            );
            expect(cpy).toHaveBeenCalledWith(
                expect.arrayContaining(['**/myQuery.xml']),
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'src', 'query') })
            );
            // 선택 모드에서 src/config 전체 복사 시 batch/**/*Job.xml 은 제외 패턴이 포함되어야 함
            expect(cpy).toHaveBeenCalledWith(
                expect.arrayContaining(['**/*', '!**/batch/**/*Job.xml', '!**/batch/**/*job.xml']),
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'src', 'config') })
            );
        });

        it('should copy user-selected batch *Job.xml files in selected mode', async () => {
            mockDeployFileList = {
                java: [],
                query: [],
                batch: ['/test/projectRoot/src/config/batch/sample/SampleJob.xml']
            };
            service = new TomcatInitService(mockLog, mockSettings, mockTomcatState, mockExtensionUri, mockDeployFileList);
            service.setDeployService(mockDeployService as any);

            const result = await service.deployServiceFiles('myRoot', 'selected', false);

            expect(result).toBe(true);
            // batch 패턴은 srcConfigPath 기준 상대경로(batch/...)로 cpy에 전달되어야 함
            expect(cpy).toHaveBeenCalledWith(
                expect.arrayContaining(['**/batch/sample/SampleJob.xml']),
                expect.any(String),
                expect.objectContaining({ cwd: path.join('/test/projectRoot', 'src', 'config') })
            );
        });

        it('should create static symlinks in developer mode', async () => {
            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith(path.join('src', 'webapp'))) return true;
                return false;
            });

            (fs.readdirSync as jest.Mock).mockReturnValue([
                { name: 'test.html', isDirectory: () => false },
                { name: 'WEB-INF', isDirectory: () => true }
            ]);

            const result = await service.deployServiceFiles('myRoot', 'default', true);

            expect(result).toBe(true);
            expect(fs.readdirSync).toHaveBeenCalled();
            expect(fs.symlinkSync).toHaveBeenCalled();
        });

        it('should copy extension lib if exists', async () => {
            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith(path.join('resources', 'lib'))) return true;
                return false;
            });

            const result = await service.deployServiceFiles('myRoot', 'default', false);

            expect(result).toBe(true);
            expect(fs.copy).toHaveBeenCalledWith(
                path.join('/test/extensionPath', 'resources', 'lib'),
                expect.any(String),
                { overwrite: true }
            );
        });

        it('should create HotSwapAgentProperties when isHotReloadMode is true', async () => {
            mockTomcatState.isHotReloadMode = true;

            const result = await service.deployServiceFiles('myRoot', 'default', false);

            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('hotswap-agent.properties'),
                expect.stringContaining('autoHotswap=true'),
                'utf8'
            );
        });

        it('should execute xplatform license creation successfully', async () => {
            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith('xplatform-license.jar')) return true;
                return false;
            });

            const result = await service.deployServiceFiles('myRoot', 'default', false);

            expect(result).toBe(true);
            expect(execFileSync).toHaveBeenCalledTimes(2); // server and client
        });

        it('should update web profile in web.xml', async () => {
            const webXmlContent = `
            <context-param>
                <param-name>spring.profiles.active</param-name>
                <param-value>local</param-value>
            </context-param>`;

            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith('web.xml')) return true;
                return false;
            });
            (fs.readFileSync as jest.Mock).mockReturnValue(webXmlContent);

            mockTomcatState.profile = 'dev';
            mockTomcatState.isBatch = true;

            const result = await service.deployServiceFiles('myRoot', 'default', false);

            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('web.xml'),
                expect.stringContaining('<param-value>dev, batch</param-value>'),
                'utf8'
            );
        });

        it('should remove jaxws endpoints from context-ws.xml in selected mode', async () => {
            mockDeployFileList = { java: [], query: [], batch: [] };
            service = new TomcatInitService(mockLog, mockSettings, mockTomcatState, mockExtensionUri, mockDeployFileList);
            service.setDeployService(mockDeployService as any);

            const contextWsContent = `
            <beans>
                <jaxws:endpoint id="testWs" implementor="#testImpl" address="/testWs" />
                <bean id="testImpl" class="com.test.TestImpl" />
            </beans>`;

            (fs.pathExistsSync as jest.Mock).mockImplementation((filepath) => {
                if (filepath.endsWith(path.join('target', 'classes'))) return true;
                if (filepath.endsWith('context-ws.xml')) return true;
                return false;
            });
            (fs.readFileSync as jest.Mock).mockReturnValue(contextWsContent);

            const result = await service.deployServiceFiles('myRoot', 'selected', false);

            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('context-ws.xml'),
                expect.not.stringContaining('<jaxws:endpoint'),
                'utf8'
            );
        });
    });
});
