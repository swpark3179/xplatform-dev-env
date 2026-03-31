const fs = require('fs');
const path = require('path');

class ClassParser {
    static MAGIC = 0xCAFEBABE;
    static CONSTANT_Class = 7;
    static CONSTANT_Fieldref = 9;
    static CONSTANT_Methodref = 10;
    static CONSTANT_InterfaceMethodref = 11;
    static CONSTANT_String = 8;
    static CONSTANT_Integer = 3;
    static CONSTANT_Float = 4;
    static CONSTANT_Long = 5;
    static CONSTANT_Double = 6;
    static CONSTANT_NameAndType = 12;
    static CONSTANT_Utf8 = 1;
    static CONSTANT_MethodHandle = 15;
    static CONSTANT_MethodType = 16;
    static CONSTANT_Dynamic = 17;
    static CONSTANT_InvokeDynamic = 18;
    static CONSTANT_Module = 19;
    static CONSTANT_Package = 20;

    static getReferencedClasses(classFilePath) {
        const references = new Set();
        if (!fs.existsSync(classFilePath)) return references;

        let buffer;
        try {
            buffer = fs.readFileSync(classFilePath);
        } catch (e) {
            return references;
        }

        if (buffer.length < 10) return references;

        let offset = 0;
        const magic = buffer.readUInt32BE(offset);
        if (magic !== ClassParser.MAGIC) return references;
        offset += 4;

        offset += 4; // minor, major

        const constantPoolCount = buffer.readUInt16BE(offset);
        offset += 2;

        const cpTypes = new Array(constantPoolCount);
        const cpStringData = new Array(constantPoolCount);
        const cpClassIndices = new Array(constantPoolCount);

        for (let i = 1; i < constantPoolCount; i++) {
            if (offset >= buffer.length) break;
            const tag = buffer.readUInt8(offset);
            offset += 1;
            cpTypes[i] = tag;

            switch (tag) {
                case ClassParser.CONSTANT_Utf8:
                    const length = buffer.readUInt16BE(offset);
                    offset += 2;
                    if (offset + length <= buffer.length) {
                        cpStringData[i] = buffer.toString('utf8', offset, offset + length);
                    }
                    offset += length;
                    break;
                case ClassParser.CONSTANT_Class:
                case ClassParser.CONSTANT_String:
                case ClassParser.CONSTANT_MethodType:
                case ClassParser.CONSTANT_Module:
                case ClassParser.CONSTANT_Package:
                    const nameIndex = buffer.readUInt16BE(offset);
                    if (tag === ClassParser.CONSTANT_Class) cpClassIndices[i] = nameIndex;
                    offset += 2;
                    break;
                case ClassParser.CONSTANT_Fieldref:
                case ClassParser.CONSTANT_Methodref:
                case ClassParser.CONSTANT_InterfaceMethodref:
                case ClassParser.CONSTANT_NameAndType:
                case ClassParser.CONSTANT_Dynamic:
                case ClassParser.CONSTANT_InvokeDynamic:
                    offset += 4;
                    break;
                case ClassParser.CONSTANT_Integer:
                case ClassParser.CONSTANT_Float:
                    offset += 4;
                    break;
                case ClassParser.CONSTANT_Long:
                case ClassParser.CONSTANT_Double:
                    offset += 8;
                    i++;
                    break;
                case ClassParser.CONSTANT_MethodHandle:
                    offset += 3;
                    break;
                default:
                    return references;
            }
        }

        for (let i = 1; i < constantPoolCount; i++) {
            if (cpTypes[i] === ClassParser.CONSTANT_Class) {
                const nameIdx = cpClassIndices[i];
                if (nameIdx > 0 && nameIdx < constantPoolCount && cpTypes[nameIdx] === ClassParser.CONSTANT_Utf8) {
                    let className = cpStringData[nameIdx];
                    if (className) {
                        if (className.startsWith('[')) {
                            const match = className.match(/\[*L([^;]+);/);
                            if (match && match[1]) {
                                className = match[1];
                            } else {
                                continue;
                            }
                        }
                        if (!className.startsWith('java/') &&
                            !className.startsWith('javax/') &&
                            !className.startsWith('sun/') &&
                            !className.startsWith('jdk/')) {
                            references.add(className);
                        }
                    }
                }
            }
        }

        return Array.from(references);
    }
}

const searchDir = path.join(__dirname, 'target', 'classes');

function findClassFile(dir) {
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
    console.log(`Found ${refs.length} references:`);
    refs.forEach(r => console.log(` - ${r}`));
} else {
    console.log('No .class file found in target/classes to test.');
}
