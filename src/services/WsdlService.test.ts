import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { WsdlService } from './WsdlService';
import { Settings } from '../types';

jest.mock('vscode', () => ({
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
    },
    OutputChannel: jest.fn(),
}), { virtual: true });

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

describe('WsdlService', () => {
    let mockLog: any;
    let mockSettings: Settings;
    let workDir: string;
    let jdkDir: string;
    let wsdlDir: string;
    let wsdlPath: string;

    // wsimport 흉내: -s 디렉토리에 지정된 상대경로 파일들을 생성하고 exitCode로 종료
    const mockWsimport = (relFiles: string[], exitCode = 0) => {
        (spawn as jest.Mock).mockImplementation((_bin: string, args: string[]) => {
            const sIdx = args.indexOf('-s');
            const outDir = args[sIdx + 1];
            for (const rel of relFiles) {
                const full = path.join(outDir, rel);
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, 'public class Generated {}', 'utf8');
            }
            return {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn((event: string, cb: (arg: any) => void) => {
                    if (event === 'close') setImmediate(() => cb(exitCode));
                }),
            };
        });
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockLog = {
            clear: jest.fn(),
            show: jest.fn(),
            appendLine: jest.fn(),
        };

        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsdl-service-test-'));
        jdkDir = path.join(workDir, 'jdk');
        const wsimportBin = process.platform === 'win32' ? 'wsimport.exe' : 'wsimport';
        fs.mkdirSync(path.join(jdkDir, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(jdkDir, 'bin', wsimportBin), '');

        wsdlDir = path.join(workDir, 'project', 'src', 'java', 'com', 'shi', 'ext', 'ws');
        fs.mkdirSync(wsdlDir, { recursive: true });
        wsdlPath = path.join(wsdlDir, 'outbound.wsdl');
        fs.writeFileSync(wsdlPath, '<definitions/>', 'utf8');

        mockSettings = {
            projectRoot: path.join(workDir, 'project'),
            gradlePath: '/test/gradle',
            jdkPath: jdkDir,
            tomcatPath: '/test/tomcat',
        };
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    describe('derivePackageFromPath', () => {
        it('should derive package from path under src/java (posix)', () => {
            expect(WsdlService.derivePackageFromPath('/proj/src/java/com/shi/ext/ws/a.wsdl'))
                .toBe('com.shi.ext.ws');
        });

        it('should derive package from path under src/java (windows)', () => {
            expect(WsdlService.derivePackageFromPath('C:\\proj\\src\\java\\com\\shi\\ws\\a.wsdl'))
                .toBe('com.shi.ws');
        });

        it('should return undefined when wsdl is directly in src/java root', () => {
            expect(WsdlService.derivePackageFromPath('/proj/src/java/a.wsdl')).toBeUndefined();
        });

        it('should return undefined when not under src/java', () => {
            expect(WsdlService.derivePackageFromPath('/proj/resources/wsdl/a.wsdl')).toBeUndefined();
        });

        it('should return undefined when a folder name is not a valid java identifier', () => {
            expect(WsdlService.derivePackageFromPath('/proj/src/java/com/my-folder/a.wsdl')).toBeUndefined();
        });
    });

    describe('generateJava', () => {
        it('should fail when wsdl file does not exist', async () => {
            const service = new WsdlService(mockLog, mockSettings);
            const result = await service.generateJava(path.join(wsdlDir, 'missing.wsdl'));
            expect(result.ok).toBe(false);
            expect(result.message).toContain('WSDL 파일을 찾을 수 없습니다');
        });

        it('should fail when jdk path is not configured', async () => {
            const service = new WsdlService(mockLog, { ...mockSettings, jdkPath: '' });
            const result = await service.generateJava(wsdlPath);
            expect(result.ok).toBe(false);
            expect(result.message).toContain('JDK 경로가 설정되지 않았습니다');
        });

        it('should fail when wsimport is missing in jdk', async () => {
            const emptyJdk = path.join(workDir, 'jdk-empty');
            fs.mkdirSync(path.join(emptyJdk, 'bin'), { recursive: true });
            const service = new WsdlService(mockLog, { ...mockSettings, jdkPath: emptyJdk });
            const result = await service.generateJava(wsdlPath);
            expect(result.ok).toBe(false);
            expect(result.message).toContain('wsimport 도구를 찾을 수 없습니다');
        });

        it('should fail when wsimport exits with non-zero code', async () => {
            mockWsimport([], 1);
            const service = new WsdlService(mockLog, mockSettings);
            const result = await service.generateJava(wsdlPath);
            expect(result.ok).toBe(false);
            expect(result.message).toContain('wsimport 실행 실패');
        });

        it('should generate java files flat into the wsdl folder when package is derived', async () => {
            mockWsimport([
                'com/shi/ext/ws/OutboundService.java',
                'com/shi/ext/ws/OutboundPort.java',
            ]);
            const service = new WsdlService(mockLog, mockSettings);
            const result = await service.generateJava(wsdlPath);

            expect(result.ok).toBe(true);
            expect(result.generatedFiles.sort()).toEqual(['OutboundPort.java', 'OutboundService.java']);
            expect(fs.existsSync(path.join(wsdlDir, 'OutboundService.java'))).toBe(true);
            expect(fs.existsSync(path.join(wsdlDir, 'OutboundPort.java'))).toBe(true);

            // wsimport 호출 검증: UTF-8 인코딩과 유도된 패키지 사용
            const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
            expect(args).toEqual(expect.arrayContaining(['-encoding', 'UTF-8', '-keep', '-Xnocompile']));
            expect(args[args.indexOf('-p') + 1]).toBe('com.shi.ext.ws');
            expect(args[args.length - 1]).toBe(wsdlPath);
        });

        it('should generate package folder structure under projectRoot/src/java when package cannot be derived', async () => {
            const outsideDir = path.join(workDir, 'project', 'resources');
            fs.mkdirSync(outsideDir, { recursive: true });
            const outsideWsdl = path.join(outsideDir, 'outbound.wsdl');
            fs.writeFileSync(outsideWsdl, '<definitions/>', 'utf8');

            mockWsimport(['com/example/ws/OutboundService.java']);
            const service = new WsdlService(mockLog, mockSettings);
            const result = await service.generateJava(outsideWsdl);

            expect(result.ok).toBe(true);
            const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
            expect(args).not.toContain('-p');
            expect(result.generatedFiles).toEqual([path.join('com', 'example', 'ws', 'OutboundService.java')]);
            expect(fs.existsSync(path.join(
                mockSettings.projectRoot, 'src', 'java', 'com', 'example', 'ws', 'OutboundService.java'
            ))).toBe(true);
            expect(fs.existsSync(path.join(outsideDir, 'com'))).toBe(false);
        });

        it('should fall back to the wsdl folder when projectRoot is not set and package cannot be derived', async () => {
            const outsideDir = path.join(workDir, 'project', 'resources');
            fs.mkdirSync(outsideDir, { recursive: true });
            const outsideWsdl = path.join(outsideDir, 'outbound.wsdl');
            fs.writeFileSync(outsideWsdl, '<definitions/>', 'utf8');

            mockWsimport(['com/example/ws/OutboundService.java']);
            const service = new WsdlService(mockLog, { ...mockSettings, projectRoot: '' });
            const result = await service.generateJava(outsideWsdl);

            expect(result.ok).toBe(true);
            expect(fs.existsSync(path.join(outsideDir, 'com', 'example', 'ws', 'OutboundService.java'))).toBe(true);
        });

        it('should ask before overwriting and cancel when declined', async () => {
            fs.writeFileSync(path.join(wsdlDir, 'OutboundService.java'), 'old', 'utf8');
            mockWsimport(['com/shi/ext/ws/OutboundService.java']);

            const service = new WsdlService(mockLog, mockSettings);
            const confirm = jest.fn().mockResolvedValue(false);
            const result = await service.generateJava(wsdlPath, confirm);

            expect(confirm).toHaveBeenCalledWith([path.join(wsdlDir, 'OutboundService.java')]);
            expect(result.ok).toBe(false);
            expect(result.cancelled).toBe(true);
            expect(fs.readFileSync(path.join(wsdlDir, 'OutboundService.java'), 'utf8')).toBe('old');
        });

        it('should overwrite when confirmed', async () => {
            fs.writeFileSync(path.join(wsdlDir, 'OutboundService.java'), 'old', 'utf8');
            mockWsimport(['com/shi/ext/ws/OutboundService.java']);

            const service = new WsdlService(mockLog, mockSettings);
            const confirm = jest.fn().mockResolvedValue(true);
            const result = await service.generateJava(wsdlPath, confirm);

            expect(result.ok).toBe(true);
            expect(fs.readFileSync(path.join(wsdlDir, 'OutboundService.java'), 'utf8')).toBe('public class Generated {}');
        });

        it('should fail when wsimport produced no java files', async () => {
            mockWsimport([]);
            const service = new WsdlService(mockLog, mockSettings);
            const result = await service.generateJava(wsdlPath);
            expect(result.ok).toBe(false);
            expect(result.message).toContain('생성한 Java 파일이 없습니다');
        });
    });
});
