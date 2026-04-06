import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClassParser } from '../utils/ClassParser';

// 배포목록관리 팝업에서 참조 파일 자동 추가를 위한 서비스
export class AnalyzeReferenceChain {
    private _projectRoot: string;

    constructor(projectRoot: string) {
        this._projectRoot = projectRoot.replace(/\\/g, '/');
    }

    // 특정 Java 소스 파일에서 참조하는 대상 Java 소스 파일 경로 Set을 얻어낸다.
    async analyzeOutboundFromFile(fileUri: vscode.Uri): Promise<Set<string>> {
        const result = new Set<string>();
        const javaFilePath = fileUri.fsPath.replace(/\\/g, '/');
        
        // src/java 디렉토리 내부의 파일인지 확인
        if (!javaFilePath.includes('/src/java/')) {
            return result;
        }

        // package/ClassName 추출
        const relativeJavaPath = javaFilePath.split('/src/java/')[1];
        const baseClassPath = relativeJavaPath.replace(/\.java$/, '');
        
        // target/classes 내부의 해당 디렉토리 경로
        const classDir = path.join(this._projectRoot, 'target', 'classes', path.dirname(baseClassPath));
        const baseName = path.basename(baseClassPath);
        
        let files: string[];
        try {
            files = await fs.promises.readdir(classDir);
        } catch (err) {
            return result;
        }

        // 메인 클래스와 이너 클래스들을 모두 찾음 (예: SomeClass.class, SomeClass$Inner.class)
        const classFiles = files.filter(f => f === `${baseName}.class` || f.startsWith(`${baseName}$`));

        // 모든 이너 클래스와 메인 클래스의 참조를 중복 없이 모음
        const uniqueReferencedClasses = new Set<string>();

        for (const classFile of classFiles) {
            const classFilePath = path.join(classDir, classFile);
            
            // 파서를 사용해 상수 풀에서 참조하는 클래스 목록 추출
            const referencedClasses = ClassParser.getReferencedClasses(classFilePath);
            
            for (const refClass of referencedClasses) {
                uniqueReferencedClasses.add(refClass);
            }
        }

        // 비동기 병렬로 파일 존재 여부 확인
        const checkPromises = Array.from(uniqueReferencedClasses).map(async (refClass) => {
            // refClass는 'com/shi/it/SomeClass' 형태
            const targetJavaRelPath = `${refClass}.java`;
            const targetJavaAbsPath = path.join(this._projectRoot, 'src', 'java', targetJavaRelPath).replace(/\\/g, '/');

            if (targetJavaAbsPath === javaFilePath) {
                return;
            }

            try {
                // 해당 Java 파일이 실제로 프로젝트 내에 존재하는지(라이브러리가 아닌지) 확인
                await fs.promises.access(targetJavaAbsPath, fs.constants.F_OK);
                result.add(targetJavaAbsPath);
            } catch {
                // 파일이 존재하지 않으면 무시
            }
        });

        await Promise.all(checkPromises);

        return result;
    }
}