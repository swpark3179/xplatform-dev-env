import { ClassParser } from './src/utils/ClassParser';
import * as path from 'path';
import * as fs from 'fs';

// Find a .class file to test
const searchDir = path.join(__dirname, 'target', 'classes');

function findClassFile(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            const found = findClassFile(fullPath);
            if (found) return found;
        } else if (file.endsWith('.class')) {
            return fullPath;
        }
    }
    return null;
}

const testFile = findClassFile(searchDir);

if (testFile) {
    console.log(`Testing ClassParser with: ${testFile}`);
    const refs = ClassParser.getReferencedClasses(testFile);
    console.log(`Found ${refs.size} references:`);
    refs.forEach(r => console.log(` - ${r}`));
} else {
    console.log('No .class file found in target/classes to test.');
}
