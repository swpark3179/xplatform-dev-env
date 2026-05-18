import * as vscode from 'vscode';
import path from 'path';
import * as fs from 'fs-extra';
import cpy from 'cpy';
import { TomcatDeployMode, Settings, TomcatState, DeployFileList } from '../types';
import { execFileSync } from 'child_process';
import type { DeployService } from './DeployService';
import type { ITomcatService } from './interfaces';

// Tomcat 초기화 서비스
export class TomcatInitService {
    private _log: vscode.OutputChannel;
    private _tomcatState: TomcatState;
    private _settings: Settings;
    private _tomcatPath: string;
    private _extensionPath: vscode.Uri;
    private _deployFileList: DeployFileList;
    private _deployService?: DeployService;
    private _tomcatService?: ITomcatService;

    constructor(log: vscode.OutputChannel, settings: Settings, tomcatState: TomcatState, extensionPath: vscode.Uri, deployFileList: DeployFileList) {
        this._log = log;
        this._tomcatState = tomcatState;
        this._settings = settings;
        this._tomcatPath = path.join(this._settings.projectRoot, '.tomcat');
        this._extensionPath = extensionPath;
        this._deployFileList = deployFileList;
    }

    /** DeployService 참조 설정 (순환 의존성 방지용 setter) */
    public setDeployService(deployService: DeployService): void {
        this._deployService = deployService;
    }

    /** TomcatService 참조 설정 (EBUSY 발생 시 Tomcat Kill 동작 트리거에 사용) */
    public setTomcatService(tomcatService: ITomcatService): void {
        this._tomcatService = tomcatService;
    }

    // Tomcat 초기화
    async initTomcat(contextRoot: string, profile: string, isBatch: boolean, deployMode: TomcatDeployMode): Promise<boolean> {
        try {
            if (!contextRoot) {
                vscode.window.showErrorMessage('Context Root가 비어있습니다.');
                return false;
            }
            // .tomcat 폴더가 존재한다면 삭제
            if (fs.pathExistsSync(this._tomcatPath)) {
                try { await this.cleanFolderSafe(this._tomcatPath); }
                catch (err) { throw new Error('파일 삭제 도중 오류 발생'); }
            }
            //tomcat 기동에 필요한 폴더 생성
            fs.emptyDirSync(this._tomcatPath);
            fs.mkdirSync(path.join(this._tomcatPath, 'conf'));
            fs.mkdirSync(path.join(this._tomcatPath, 'webapps'));
            fs.mkdirSync(path.join(this._tomcatPath, 'logs'));
            fs.mkdirSync(path.join(this._tomcatPath, 'temp'));
            fs.mkdirSync(path.join(this._tomcatPath, 'work'));
            fs.mkdirSync(path.join(this._tomcatPath, 'webapps', contextRoot));
            // tomcat 기동에 필수적인 파일 생성
            this.createServerXml();
            this.createContextXml();
            Promise.all([
                cpy(path.join(this._settings.tomcatPath, 'conf', 'web.xml'), path.join(this._tomcatPath, 'conf')),
                cpy(path.join(this._settings.tomcatPath, 'conf', 'logging.properties'), path.join(this._tomcatPath, 'conf')),
                cpy(path.join(this._settings.tomcatPath, 'conf', 'catalina.properties'), path.join(this._tomcatPath, 'conf')),
                cpy(path.join(this._settings.tomcatPath, 'conf', 'tomcat-users.xml'), path.join(this._tomcatPath, 'conf')),
            ]);
            // state 정리
            this._tomcatState.contextRoot = contextRoot;
            this._tomcatState.profile = profile;
            this._tomcatState.isBatch = isBatch;
            this._tomcatState.deployMode = deployMode;
            this._deployService?.saveDeploySettings(); // 설정 파일에 반영
            // 마무리
            this._tomcatState.initialized = true;
            this._log.appendLine(`Tomcat 초기화 완료 (Context Root: ${contextRoot})`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log.appendLine(`Tomcat 초기화 실패: ${errorMessage}`);
            return false;
        }
    }

    // 폴더 비우기 (재시도 로직 포함)
    private async cleanFolderSafe(targetPath: string, maxRetries = 2) {
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)); // 지정된 시간(ms)만큼 대기하는 유틸리티
        let killAttempted = false;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this._log.appendLine(`폴더 비우기 시도... (${targetPath})`);
                await fs.emptyDir(targetPath); // 폴더는 놔두고 내용물만 삭제
                return;
            } catch (error: any) {
                if (error.code === 'EBUSY' || error.code === 'EPERM') {
                    if (attempt >= maxRetries) {
                        // 마지막 시도에서도 EBUSY → Tomcat Kill 동작을 한 번 더 수행하고 한 번 더 재시도
                        if (!killAttempted && this._tomcatService) {
                            killAttempted = true;
                            this._log.appendLine(`[EBUSY 감지] 파일이 사용 중입니다. Tomcat Kill 동작 후 재시도합니다...`);
                            try {
                                this._tomcatService.killTomcatProcess();
                                this._tomcatService.killProcessesOnTomcatPorts();
                            } catch (killErr) {
                                this._log.appendLine(`[Tomcat Kill] 실패: ${killErr instanceof Error ? killErr.message : String(killErr)}`);
                            }
                            await wait(2000); // 2초 대기 후 한 번 더 시도
                            try {
                                this._log.appendLine(`폴더 비우기 재시도... (${targetPath})`);
                                await fs.emptyDir(targetPath);
                                return;
                            } catch (retryError) {
                                throw retryError;
                            }
                        }
                        throw error; // Tomcat Kill 후에도 실패했거나 서비스 미설정이면 에러를 던짐
                    }
                    this._log.appendLine(`[EBUSY 감지] 파일이 사용 중입니다. 2초 뒤 재시도합니다... (${attempt}/${maxRetries})`);
                    await wait(2000); // 2초 대기
                }
                else throw error; // 다른 종류의 오류는 즉시 중단
            }
        }
    }

    // 파일 복사 (진행률 표시)
    private async copyWithProgress(type: string, src: string, dest: string, pattern: string | string[]) {
        fs.ensureDirSync(dest); // dest 폴더가 없으면 생성
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `[${type}] 파일 복사 중...`,
            cancellable: false,
        }, async (progress) => {
            progress.report({ message: '준비 중...', increment: 0 });
            let lastPercentage = 0;
            await cpy(pattern, dest, {
                cwd: `${src}`,
                overwrite: true,
                concurrency: 300,
                onProgress: (event: any) => {
                    const currentPercentage = Math.round(event.percent * 100);
                    const diff = currentPercentage - lastPercentage;
                    lastPercentage = currentPercentage;
                    progress.report({
                        message: `${event.completedFiles} / ${event.totalFiles} 파일 복사 중... (${currentPercentage}%)`,
                        increment: diff
                    });
                }
            });
        });
    }

    // 서비스 파일 배포 (성공 시 true return)
    public async deployServiceFiles(contextRoot: string, deployMode: TomcatDeployMode, isDeveloperMode: boolean = false): Promise<boolean> {
        const _deployPath = path.join(this._tomcatPath, 'webapps', contextRoot);
        const srcClassesPath = path.join(this._settings.projectRoot, 'target', 'classes');
        const srcQueryPath = path.join(this._settings.projectRoot, 'src', 'query');
        const srcConfigPath: string = path.join(this._settings.projectRoot, 'src', 'config');
        const webappPath = path.join(this._settings.projectRoot, 'src', 'webapp');
        const projectLibPath = path.join(this._settings.projectRoot, 'src', 'lib');
        const tomcatLibPath = path.join(_deployPath, 'WEB-INF', 'lib');
        const targetClassesPath = path.join(_deployPath, 'WEB-INF', 'classes');
        if (!fs.pathExistsSync(srcClassesPath)) {
            this._log.appendLine(`[경고] 빌드된 class 파일을 찾을 수 없습니다: ${srcClassesPath}`);
            return false;
        }
        const start_time = Date.now();
        this._log.show(true);
        this._log.appendLine('[배포] 서비스 파일 복사 시작');
        if (deployMode === 'default') { // 기본 모드 : 전체 파일 복사
            await Promise.all([
                isDeveloperMode
                    ? this._createStaticSymlinks(webappPath, _deployPath)
                    : this.copyWithProgress('정적 파일', webappPath, _deployPath, ['**/*', '!**/WEB-INF/lib', '!**/XPLATFORM_Client_License.xml']),
                this.copyWithProgress('Java', srcClassesPath, targetClassesPath, '**/*.class*'),
                this.copyWithProgress('Query', srcQueryPath, targetClassesPath, '**/*'),
                this.copyWithProgress('Config', srcConfigPath, targetClassesPath, '**/*'),
                this.copyWithProgress('Lib', projectLibPath, tomcatLibPath, '**/*'),
            ]);
        } else { // 선택 모드 : 정적파일은 전체, WSDL 및 인터페이스는 제거, Java 및 Query는 선택된 파일만 복사
            // 배포대상 목록에서 java 복사대상 패턴 생성
            const javaClassPatterns = this._deployFileList.java.map(javaFile => {
                const normalized = javaFile.replace(/\\/g, '/');
                const idx = normalized.indexOf('/src/java/');
                const relativePath = idx !== -1 ? normalized.substring(idx + '/src/java/'.length) : normalized;
                const lastSlash = relativePath.lastIndexOf('/');
                const packagePath = lastSlash !== -1 ? relativePath.substring(0, lastSlash) : '';
                const fileName = (lastSlash !== -1 ? relativePath.substring(lastSlash + 1) : relativePath).replace(/\.java$/, '');
                return packagePath ? `**/${packagePath}/${fileName}*.class*` : `**/${fileName}*.class*`;
            }).concat('**/com/shi/*/*Config*.class*'); // ~~~Config.java 파일들은 선택모드에서도 항상 복사되도록 추가
            // 배포대상 목록에서 query 복사대상 패턴 생성
            const queryPatterns = this._deployFileList.query.map(queryFile => {
                const normalized = queryFile.replace(/\\/g, '/');
                const idx = normalized.indexOf('/src/query/');
                return idx !== -1 ? `**/${normalized.substring(idx + '/src/query/'.length)}` : `**/${normalized}`;
            });
            // 배포대상 목록에서 batch(*Job.xml) 복사대상 패턴 생성 (cwd가 srcConfigPath 이므로 batch/... 상대경로)
            const batchPatterns = this._deployFileList.batch.map(batchFile => {
                const normalized = batchFile.replace(/\\/g, '/');
                const idx = normalized.indexOf('/src/config/');
                return idx !== -1 ? `**/${normalized.substring(idx + '/src/config/'.length)}` : `**/${normalized}`;
            });
            await Promise.all([
                isDeveloperMode
                    ? this._createStaticSymlinks(webappPath, _deployPath)
                    : this.copyWithProgress('정적 파일', webappPath, _deployPath, ['**/*', '!**/WEB-INF/lib', '!**/XPLATFORM_Client_License.xml']),
                (javaClassPatterns.length > 0) ? this.copyWithProgress('Java', srcClassesPath, targetClassesPath, javaClassPatterns) : Promise.resolve(),
                (queryPatterns.length > 0) ? this.copyWithProgress('Query', srcQueryPath, targetClassesPath, queryPatterns) : Promise.resolve(),
                // 선택 모드: src/config 전체 복사 시 batch/**/*Job.xml(대소문자 무시)은 항상 제외
                this.copyWithProgress('Config', srcConfigPath, targetClassesPath, ['**/*', '!**/batch/**/*Job.xml', '!**/batch/**/*job.xml']),
                // 사용자가 선택한 batch *Job.xml 파일만 추가 복사
                (batchPatterns.length > 0) ? this.copyWithProgress('Batch', srcConfigPath, targetClassesPath, batchPatterns) : Promise.resolve(),
                this.copyWithProgress('Lib', projectLibPath, tomcatLibPath, '**/*'),
            ]);
            //this._commentOutWsdlProperties(targetClassesPath); // wsdl properties 파일 내용 수정 (전체 주석 처리) -> 주석 처리 필요 없음
            this._removeJaxwsEndpointsFromContextWs(targetClassesPath); // context-ws.xml 파일 내용 수정 (ws 제거)
        }
        const end_time = Date.now();
        this._log.appendLine(`[배포] 서비스 파일 복사 완료 (${((end_time - start_time) / 1000).toFixed(2)}초)`);
        // vscode 확장 프로그램 내 lib가 있으면 복사
        const extensionLibPath = path.join(this._extensionPath.fsPath, 'resources', 'lib');
        if (fs.pathExistsSync(extensionLibPath)) await fs.copy(extensionLibPath, tomcatLibPath, { overwrite: true });
        this.createXplatformLicense(); // XPlatform 데모 라이센스 파일 생성
        if (this._tomcatState.isHotReloadMode) this.createHotSwapAgentProperties(_deployPath); // hostswap-agent 설정파일 생성
        this.updateWebProfile(this._tomcatState.profile, this._tomcatState.isBatch); // web.xml 파일 내용 수정 (프로파일 반영)
        this._tomcatState.deployPath = _deployPath;
        return true;
    }

    // server.xml 파일 생성
    private createServerXml(): void {
        const serverXml = `<?xml version="1.0" encoding="UTF-8"?>
<Server port="8005" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener" />
  <Listener className="org.apache.catalina.core.AprLifecycleListener" />
  <Listener className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />
  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener" />
  <Listener className="org.apache.catalina.core.ThreadLocalLeakPreventionListener" />

  <GlobalNamingResources>
    <Resource name="UserDatabase" auth="Container"
              type="org.apache.catalina.UserDatabase"
              description="User database that can be updated and saved"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory"
              pathname="conf/tomcat-users.xml" />
  </GlobalNamingResources>

  <Service name="Catalina">
    <Connector port="7001" protocol="HTTP/1.1" connectionTimeout="20000" redirectPort="8443" maxParameterCount="1000" />
    <Engine name="Catalina" defaultHost="localhost">
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm" resourceName="UserDatabase"/>
      </Realm>
      <Host name="localhost"  appBase="webapps" unpackWARs="true" autoDeploy="true">
        <Context path="/${this._tomcatState.contextRoot}" docBase="${this._tomcatPath.replace(/\\/g, '/')}/webapps/${this._tomcatState.contextRoot}" />
        <Valve className="org.apache.catalina.valves.AccessLogValve" directory="logs" prefix="localhost_access_log" suffix=".txt" pattern="%h %l %u %t &quot;%r&quot; %s %b" />
      </Host>
    </Engine>
  </Service>
</Server>
`;
        fs.writeFileSync(path.join(this._tomcatPath, 'conf', 'server.xml'), serverXml, 'utf8');
    }

    // context.xml 파일 생성
    private createContextXml(): void {
        const contextXml = `<?xml version="1.0" encoding="UTF-8"?>
<Context>
    <WatchedResource>WEB-INF/web.xml</WatchedResource>
    <WatchedResource>\${catalina.base}/conf/web.xml</WatchedResource>
    <JarScanner>
        <JarScanFilter defaultTldScan="false" />
    </JarScanner>
    <Resources cachingAllowed="true" cacheMaxSize="100000" />
</Context>
`;
        fs.writeFileSync(path.join(this._tomcatPath, 'conf', 'context.xml'), contextXml, 'utf8');
    }

    // XPlatform 데모 라이센스 파일 생성
    private createXplatformLicense(): void {
        const licenseCreatorPath = path.join(this._extensionPath.fsPath, 'resources', 'xplatform-license.jar');
        if (!fs.pathExistsSync(licenseCreatorPath)) {
            this._log.appendLine('XPlatform License creater is not exists.');
            return;
        }

        const javaExe = path.join(this._settings.jdkPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        const contextRoot = this._tomcatState.contextRoot;

        // 서버용 라이센스: output_path = this._tomcatPath/lib
        const serverOutputPath = path.join(this._tomcatPath, 'webapps', contextRoot, 'WEB-INF', 'lib');
        if (!fs.pathExistsSync(serverOutputPath)) fs.mkdirSync(serverOutputPath, { recursive: true });
        try {
            execFileSync(javaExe, [
                '-Dfile.encoding=UTF-8',
                '-jar',
                licenseCreatorPath,
                'server',
                path.join(serverOutputPath, 'XPLATFORM_Server_License.xml')
            ], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (e) {
            this._log.appendLine(`[XPlatform License] 서버용 라이센스 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }

        // 클라이언트용 라이센스: output_path = this._settings.projectRoot/.vscode/ui-env
        const clientOutputPath = path.join(this._settings.projectRoot, '.vscode', 'ui-env');
        if (!fs.pathExistsSync(clientOutputPath)) fs.mkdirSync(clientOutputPath, { recursive: true });

        const clientLicenseFile = path.join(clientOutputPath, 'XPLATFORM_Client_License.xml');
        try {
            execFileSync(javaExe, [
                '-Dfile.encoding=UTF-8',
                '-jar',
                licenseCreatorPath,
                'client',
                clientLicenseFile
            ], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (e) {
            this._log.appendLine(`[XPlatform License] 클라이언트용 라이센스 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }

        // 생성된 클라이언트용 라이센스를 tomcat webapps 하위로 복사
        const tomcatUiPath = path.join(this._tomcatPath, 'webapps', contextRoot, 'ui');
        if (!fs.pathExistsSync(tomcatUiPath)) fs.mkdirSync(tomcatUiPath, { recursive: true });
        try {
            fs.copyFileSync(clientLicenseFile, path.join(tomcatUiPath, 'XPLATFORM_Client_License.xml'));
        } catch (e) {
            this._log.appendLine(`[XPlatform License] 클라이언트 라이센스 복사 실패: ${e instanceof Error ? e.message : String(e)}`);
        }

        this._log.appendLine('[XPlatform License] 데모 라이센스 생성 완료');
    }

    // hotswap-agent.properties 파일 생성
    private createHotSwapAgentProperties(_deployPath: string): void {
        const fileContent = `extraClasspath=${_deployPath.replace(/\\/g, '/')}/WEB-INF/classes
autoHotswap=true
plugin.spring=true
spring.bean_refresh=true`;
        fs.writeFileSync(path.join(_deployPath, 'WEB-INF', 'classes', 'hotswap-agent.properties'), fileContent, 'utf8');
    }

    // tomcat 배포 폴더의 web.xml 파일에 프로파일 반영
    private updateWebProfile(profile: string, isBatch: boolean): void {
        const webProfilePath = path.join(this._tomcatPath, 'webapps', this._tomcatState.contextRoot, 'WEB-INF', 'web.xml');
        if (!fs.pathExistsSync(webProfilePath)) return;
        let content = fs.readFileSync(webProfilePath, 'utf8');

        const paramValue = isBatch ? `${profile}, batch` : profile;
        // <context-param> 블록 단위로 처리: spring.profiles.active인 param-name 다음의 param-value만 교체
        const contextParamRegex = /<context-param>[\s\S]*?<\/context-param>/g;
        content = content.replace(contextParamRegex, (block) => {
            const paramNameMatch = block.match(/<param-name>\s*spring\.profiles\.active\s*<\/param-name>/);
            if (!paramNameMatch) return block;
            return block.replace(
                /<param-value>\s*[\s\S]*?\s*<\/param-value>/,
                `<param-value>${paramValue}</param-value>`
            );
        });

        fs.writeFileSync(webProfilePath, content, 'utf8');
    }

    /** 개발자 모드: 정적 파일 복사 대신 심볼릭 링크 생성 (WEB-INF/lib 제외, ui/XPLATFORM_Client_License.xml 제외) */
    private async _createStaticSymlinks(webappPath: string, deployPath: string): Promise<void> {
        if (!fs.pathExistsSync(webappPath)) return;
        const entries = fs.readdirSync(webappPath, { withFileTypes: true });
        for (const entry of entries) {
            const srcFull = path.join(webappPath, entry.name);
            const destFull = path.join(deployPath, entry.name);
            if (entry.name === 'WEB-INF') {
                // WEB-INF 하위는 개별 처리: lib 제외, 나머지만 심볼릭 링크
                fs.ensureDirSync(destFull);
                const webInfEntries = fs.readdirSync(srcFull, { withFileTypes: true });
                for (const wi of webInfEntries) {
                    if (wi.name === 'lib') continue; // lib은 별도 cpy로 복사됨
                    const wiSrc = path.join(srcFull, wi.name);
                    const wiDest = path.join(destFull, wi.name);
                    if (fs.existsSync(wiDest)) fs.removeSync(wiDest);
                    fs.symlinkSync(wiSrc, wiDest, wi.isDirectory() ? 'junction' : 'file');
                }
                continue;
            } else if (entry.name === 'ui' && entry.isDirectory()) {
                fs.ensureDirSync(destFull);
                const uiEntries = fs.readdirSync(srcFull, { withFileTypes: true });
                for (const uiEntry of uiEntries) {
                    if (uiEntry.name === 'XPLATFORM_Client_License.xml') continue;
                    const uiSrc = path.join(srcFull, uiEntry.name);
                    const uiDest = path.join(destFull, uiEntry.name);
                    if (fs.existsSync(uiDest)) fs.removeSync(uiDest);
                    fs.symlinkSync(uiSrc, uiDest, uiEntry.isDirectory() ? 'junction' : 'file');
                }
                continue;
            }
            if (fs.existsSync(destFull)) fs.removeSync(destFull);
            fs.symlinkSync(srcFull, destFull, entry.isDirectory() ? 'junction' : 'file');
        }
        this._log.appendLine(`[배포] 정적 파일 심볼릭 링크 생성 완료`);
    }

    // targetClassesPath/properties/wsdl.properties: #로 시작하지 않는 각 줄 앞에 # 붙여 주석 처리
    private _commentOutWsdlProperties(targetClassesPath: string): void {
        const wsdlPath = path.join(targetClassesPath, 'properties', 'wsdl.properties');
        if (!fs.pathExistsSync(wsdlPath)) return;
        try {
            const content = fs.readFileSync(wsdlPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const commented = lines.map((line) => (line.trimStart().startsWith('#') ? line : `#${line}`));
            fs.writeFileSync(wsdlPath, commented.join('\n'), 'utf8');
        } catch {
            // 읽기/쓰기 실패 시 무시
        }
    }

    // targetClassesPath/context/context-ws.xml: <jaxws:endpoint ... /> 태그 모두 삭제
    private _removeJaxwsEndpointsFromContextWs(targetClassesPath: string): void {
        const contextWsPath = path.join(targetClassesPath, 'context', 'context-ws.xml');
        if (!fs.pathExistsSync(contextWsPath)) return;
        try {
            let content = fs.readFileSync(contextWsPath, 'utf8');
            content = content.replace(/<jaxws:endpoint[\s\S]*?\/>/g, '');
            fs.writeFileSync(contextWsPath, content, 'utf8');
        } catch {
            // 읽기/쓰기 실패 시 무시
        }
    }
}