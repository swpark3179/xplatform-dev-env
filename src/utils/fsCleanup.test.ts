import * as fs from 'fs-extra';
import path from 'path';
import { safeEmptyDir } from './fsCleanup';

jest.mock('fs-extra', () => ({
    pathExists: jest.fn(),
    ensureDir: jest.fn(),
    readdir: jest.fn(),
    lstat: jest.fn(),
    remove: jest.fn(),
    unlink: jest.fn(),
    rmdir: jest.fn(),
}));

const TARGET = '/test/.tomcat/webapps/ROOT';

describe('safeEmptyDir', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
        (fs.ensureDir as unknown as jest.Mock).mockResolvedValue(undefined);
        (fs.readdir as unknown as jest.Mock).mockResolvedValue([]);
        (fs.lstat as unknown as jest.Mock).mockResolvedValue({ isSymbolicLink: () => false });
        (fs.remove as unknown as jest.Mock).mockResolvedValue(undefined);
        (fs.unlink as unknown as jest.Mock).mockResolvedValue(undefined);
        (fs.rmdir as unknown as jest.Mock).mockResolvedValue(undefined);
    });

    it('대상이 없으면 폴더를 생성한다', async () => {
        (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);
        await safeEmptyDir(TARGET);
        expect(fs.ensureDir).toHaveBeenCalledWith(TARGET);
        expect(fs.remove).not.toHaveBeenCalled();
    });

    it('일반 파일/디렉터리는 remove로 제거한다', async () => {
        (fs.readdir as unknown as jest.Mock).mockResolvedValue(['a.txt', 'sub']);
        await safeEmptyDir(TARGET);
        expect(fs.remove).toHaveBeenCalledWith(path.join(TARGET, 'a.txt'));
        expect(fs.remove).toHaveBeenCalledWith(path.join(TARGET, 'sub'));
    });

    it('심볼릭 링크/junction은 타깃을 따라가지 않고 unlink로만 제거한다', async () => {
        (fs.readdir as unknown as jest.Mock).mockResolvedValue(['rd']);
        (fs.lstat as unknown as jest.Mock).mockResolvedValue({ isSymbolicLink: () => true });
        await safeEmptyDir(TARGET);
        expect(fs.unlink).toHaveBeenCalledWith(path.join(TARGET, 'rd'));
        expect(fs.remove).not.toHaveBeenCalled();
    });

    it('디렉터리 junction unlink가 EPERM이면 rmdir로 폴백한다', async () => {
        (fs.readdir as unknown as jest.Mock).mockResolvedValue(['rd']);
        (fs.lstat as unknown as jest.Mock).mockResolvedValue({ isSymbolicLink: () => true });
        const eperm: any = new Error('EPERM');
        eperm.code = 'EPERM';
        (fs.unlink as unknown as jest.Mock).mockRejectedValueOnce(eperm);
        await safeEmptyDir(TARGET);
        expect(fs.rmdir).toHaveBeenCalledWith(path.join(TARGET, 'rd'));
    });

    it('EBUSY 발생 시 재시도하고, 마지막 시도 직전 kill 콜백을 실행한 뒤 성공한다', async () => {
        const ebusy: any = new Error('EBUSY');
        ebusy.code = 'EBUSY';
        // pathExists는 매번 true, readdir이 두 번 EBUSY로 실패 후 세 번째에 성공
        (fs.readdir as unknown as jest.Mock)
            .mockRejectedValueOnce(ebusy)
            .mockRejectedValueOnce(ebusy)
            .mockResolvedValueOnce([]);
        const onBusy = jest.fn();

        await safeEmptyDir(TARGET, { retryDelayMs: 0, onBusyBeforeFinalRetry: onBusy });

        expect(onBusy).toHaveBeenCalledTimes(1);
        expect(fs.readdir).toHaveBeenCalledTimes(3);
    });

    it('EBUSY/EPERM이 아닌 오류는 즉시 던진다', async () => {
        const enoent: any = new Error('ENOENT');
        enoent.code = 'ENOENT';
        (fs.readdir as unknown as jest.Mock).mockRejectedValue(enoent);
        await expect(safeEmptyDir(TARGET, { retryDelayMs: 0 })).rejects.toThrow('ENOENT');
        expect(fs.remove).not.toHaveBeenCalled();
    });

    it('kill 콜백 후에도 계속 EBUSY면 최종적으로 예외를 던진다', async () => {
        const ebusy: any = new Error('EBUSY');
        ebusy.code = 'EBUSY';
        (fs.readdir as unknown as jest.Mock).mockRejectedValue(ebusy);
        const onBusy = jest.fn();
        await expect(
            safeEmptyDir(TARGET, { retryDelayMs: 0, onBusyBeforeFinalRetry: onBusy })
        ).rejects.toThrow('EBUSY');
        expect(onBusy).toHaveBeenCalledTimes(1);
    });
});
