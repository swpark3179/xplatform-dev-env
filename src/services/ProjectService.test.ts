import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProjectService } from './ProjectService';
import { Settings } from '../types';

jest.mock('vscode', () => ({
    window: {
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showInputBox: jest.fn(),
    },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/test/project' } }],
    },
    OutputChannel: jest.fn(),
}), { virtual: true });

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(),
}));

const PROJECT_ROOT = '/test/project';

describe('ProjectService', () => {
    let mockLog: any;
    let mockSettings: Settings;
    let mockExtensionPath: vscode.Uri;
    let service: ProjectService;

    // 특정 확장자로 끝나는 경로만 존재하도록 제어하는 헬퍼
    const setExisting = (predicate: (p: string) => boolean) => {
        (fs.existsSync as jest.Mock).mockImplementation((p: string) => predicate(p));
    };

    // writeFileSync 호출 대상 경로 중 특정 파일이 쓰였는지 확인
    const wroteFile = (suffix: string): boolean =>
        (fs.writeFileSync as jest.Mock).mock.calls.some(
            (call) => typeof call[0] === 'string' && call[0].endsWith(suffix)
        );

    beforeEach(() => {
        jest.clearAllMocks();

        mockLog = {
            clear: jest.fn(),
            show: jest.fn(),
            appendLine: jest.fn(),
        };

        mockSettings = {
            projectRoot: PROJECT_ROOT,
            gradlePath: '/test/gradle',
            jdkPath: '/test/jdk',
            tomcatPath: '/test/tomcat',
        };

        mockExtensionPath = { fsPath: '/test/ext' } as unknown as vscode.Uri;

        // workspaceFolders 기본값 복원
        (vscode as any).workspace.workspaceFolders = [{ uri: { fsPath: PROJECT_ROOT } }];

        // updateClassPathFile()가 다시 읽는 .classpath 내용
        (fs.readFileSync as jest.Mock).mockReturnValue('<classpath>\n</classpath>\n');

        service = new ProjectService(mockLog, mockSettings, mockExtensionPath);
    });

    describe('generateMissingProjectFiles', () => {
        it('.project만 없을 때 .project만 생성한다', async () => {
            setExisting((p) => {
                if (p.endsWith('.project')) return false; // 누락
                if (p.endsWith('.classpath')) return true; // 존재
                return false;
            });

            await service.generateMissingProjectFiles();

            expect(wroteFile('.project')).toBe(true);
            expect(wroteFile('.classpath')).toBe(false); // 이미 있으므로 재생성하지 않음
            expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        });

        it('.classpath만 없을 때 .classpath만 생성한다', async () => {
            setExisting((p) => {
                if (p.endsWith('.project')) return true; // 존재
                if (p.endsWith('.classpath')) return false; // 누락
                return false; // rt.jar, src/lib 없음
            });

            await service.generateMissingProjectFiles();

            expect(wroteFile('.classpath')).toBe(true);
            expect(wroteFile('.project')).toBe(false); // 이미 있으므로 재생성하지 않음
            expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        });

        it('두 파일이 모두 있으면 아무것도 하지 않는다', async () => {
            setExisting(() => true); // 모두 존재

            await service.generateMissingProjectFiles();

            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        });

        it('워크스페이스 폴더가 없으면 조기 종료한다', async () => {
            (vscode as any).workspace.workspaceFolders = undefined;

            await service.generateMissingProjectFiles();

            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        });
    });

    describe('initProjectSettings (silent)', () => {
        it('silent=true 이면 덮어쓰기 확인 팝업 없이 파일을 생성한다', async () => {
            setExisting((p) => {
                if (p.endsWith('.vscode')) return true; // .vscode 디렉터리 존재 → mkdir 생략
                return false; // settings.json / .project / .classpath / rt.jar / src/lib 모두 없음
            });

            await service.initProjectSettings(
                { hideSimpleFolder: true, hideExtFolder: false, initProjectFile: true },
                true
            );

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled(); // 확인 팝업 생략
            expect(wroteFile('settings.json')).toBe(true);
            expect(wroteFile('.project')).toBe(true);
            expect(wroteFile('.classpath')).toBe(true);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('프로젝트 설정 적용 완료');
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        });

        it('silent 미지정 시 기존 파일이 있으면 확인 팝업을 띄우고, 거부하면 파일을 덮어쓰지 않는다', async () => {
            setExisting((p) => {
                if (p.endsWith('.vscode')) return true;
                if (p.endsWith('settings.json')) return false;
                if (p.endsWith('.project')) return true; // 이미 존재
                if (p.endsWith('.classpath')) return true; // 이미 존재
                return false;
            });
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('아니오');

            await service.initProjectSettings({
                hideSimpleFolder: true,
                hideExtFolder: false,
                initProjectFile: true,
            });

            expect(vscode.window.showWarningMessage).toHaveBeenCalled(); // 확인 팝업 표시
            expect(wroteFile('settings.json')).toBe(true); // settings.json은 항상 적용
            expect(wroteFile('.project')).toBe(false); // 거부 → 덮어쓰지 않음
            expect(wroteFile('.classpath')).toBe(false);
        });
    });
});
