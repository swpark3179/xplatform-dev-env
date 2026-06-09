import * as fs from 'fs-extra';
import path from 'path';

// 폴더 정리(teardown) 공용 유틸리티
// - 초기화(initTomcat)와 (재)시작(runTomcat) 경로가 동일한 로직을 공유하도록 분리
// - Windows에서 자주 발생하는 EBUSY/EPERM(파일/디렉터리 핸들이 아직 해제되지 않음)을 재시도로 흡수
// - 정적 파일 심볼릭 링크/junction은 "타고 들어가지 않고" 링크 자체만 제거하여 원본 손실 방지

export interface SafeEmptyDirOptions {
    /** EBUSY/EPERM 발생 시 최대 재시도 횟수 (기본 2) */
    maxRetries?: number;
    /** 재시도 간 대기 시간(ms) (기본 2000) */
    retryDelayMs?: number;
    /** 진행 로그 출력 콜백 */
    log?: (message: string) => void;
    /** 마지막 재시도 직전에 한 번 실행되는 콜백 (예: Tomcat 프로세스 강제 종료) */
    onBusyBeforeFinalRetry?: () => void | Promise<void>;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 단일 엔트리를 안전하게 제거한다.
 * 심볼릭 링크/junction이면 링크 자체만 제거(unlink/rmdir)하고 타깃을 따라가지 않는다.
 * (Windows에서 디렉터리 junction은 unlink가 EPERM을 내므로 rmdir로 폴백)
 */
async function removeEntrySafe(entryPath: string): Promise<void> {
    let stat: fs.Stats;
    try {
        stat = await fs.lstat(entryPath);
    } catch (err: any) {
        if (err.code === 'ENOENT') return; // 이미 없음
        throw err;
    }

    if (stat.isSymbolicLink()) {
        try {
            await fs.unlink(entryPath);
        } catch (err: any) {
            // 디렉터리 junction 등은 unlink가 EPERM/EISDIR/ENOTEMPTY를 낼 수 있어 rmdir로 폴백
            if (err.code === 'EPERM' || err.code === 'EISDIR' || err.code === 'ENOTEMPTY') {
                await fs.rmdir(entryPath);
            } else {
                throw err;
            }
        }
        return;
    }

    // 일반 파일/디렉터리는 fs-extra remove(재귀 삭제)에 위임
    await fs.remove(entryPath);
}

/** 폴더 내용물만 비운다(폴더 자체는 유지). 심볼릭 링크/junction 안전 처리. */
async function emptyDirSafeOnce(targetPath: string): Promise<void> {
    if (!await fs.pathExists(targetPath)) {
        await fs.ensureDir(targetPath);
        return;
    }
    const entries = await fs.readdir(targetPath);
    await Promise.all(entries.map(entry => removeEntrySafe(path.join(targetPath, entry))));
}

/**
 * 폴더 내용물을 비운다. EBUSY/EPERM은 재시도하고, 마지막 시도 직전에 onBusyBeforeFinalRetry(예: Tomcat kill)를 실행한다.
 * 심볼릭 링크/junction은 링크만 제거하여 원본 데이터 손실을 방지한다.
 */
export async function safeEmptyDir(targetPath: string, options: SafeEmptyDirOptions = {}): Promise<void> {
    const { maxRetries = 2, retryDelayMs = 2000, log, onBusyBeforeFinalRetry } = options;
    let busyHandled = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log?.(`폴더 비우기 시도... (${targetPath})`);
            await emptyDirSafeOnce(targetPath);
            return;
        } catch (error: any) {
            const isBusy = error.code === 'EBUSY' || error.code === 'EPERM';
            if (!isBusy) throw error; // 다른 종류의 오류는 즉시 중단

            if (attempt < maxRetries) {
                log?.(`[EBUSY 감지] 파일이 사용 중입니다. ${Math.round(retryDelayMs / 1000)}초 뒤 재시도합니다... (${attempt}/${maxRetries})`);
                await wait(retryDelayMs);
                continue;
            }

            // 마지막 시도에서도 실패 → kill 콜백 후 한 번 더 시도
            if (!busyHandled && onBusyBeforeFinalRetry) {
                busyHandled = true;
                log?.(`[EBUSY 감지] 파일이 사용 중입니다. Tomcat Kill 동작 후 재시도합니다...`);
                await onBusyBeforeFinalRetry();
                await wait(retryDelayMs);
                log?.(`폴더 비우기 재시도... (${targetPath})`);
                await emptyDirSafeOnce(targetPath);
                return;
            }
            throw error;
        }
    }
}
