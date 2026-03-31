import * as fs from 'fs';
import * as path from 'path';

/**
 * A highly optimized pure TypeScript parser for Java .class files.
 * It strictly parses the Constant Pool to find all referenced class names.
 */
export class ClassParser {
    // Java Class File Format Constants
    private static readonly MAGIC = 0xCAFEBABE;
    private static readonly CONSTANT_Class = 7;
    private static readonly CONSTANT_Fieldref = 9;
    private static readonly CONSTANT_Methodref = 10;
    private static readonly CONSTANT_InterfaceMethodref = 11;
    private static readonly CONSTANT_String = 8;
    private static readonly CONSTANT_Integer = 3;
    private static readonly CONSTANT_Float = 4;
    private static readonly CONSTANT_Long = 5;
    private static readonly CONSTANT_Double = 6;
    private static readonly CONSTANT_NameAndType = 12;
    private static readonly CONSTANT_Utf8 = 1;
    private static readonly CONSTANT_MethodHandle = 15;
    private static readonly CONSTANT_MethodType = 16;
    private static readonly CONSTANT_Dynamic = 17;
    private static readonly CONSTANT_InvokeDynamic = 18;
    private static readonly CONSTANT_Module = 19;
    private static readonly CONSTANT_Package = 20;

    /**
     * Reads a .class file and returns a Set of internal class names referenced by it.
     * Returned format: 'com/shi/it/SomeClass'
     * @param classFilePath Absolute path to the .class file
     * @returns Set of referenced class names
     */
    public static getReferencedClasses(classFilePath: string): Set<string> {
        const references = new Set<string>();

        if (!fs.existsSync(classFilePath)) {
            return references;
        }

        let buffer: Buffer;
        try {
            buffer = fs.readFileSync(classFilePath);
        } catch (e) {
            return references;
        }

        if (buffer.length < 10) return references;

        let offset = 0;

        // 1. Check Magic Number
        const magic = buffer.readUInt32BE(offset);
        if (magic !== ClassParser.MAGIC) {
            return references;
        }
        offset += 4;

        // 2. Minor / Major Version
        offset += 4;

        // 3. Constant Pool Count
        const constantPoolCount = buffer.readUInt16BE(offset);
        offset += 2;

        // Read Constant Pool
        // Type array to hold types, and Data array to hold string/indices
        const cpTypes = new Array<number>(constantPoolCount);
        const cpStringData = new Array<string>(constantPoolCount);
        const cpClassIndices = new Array<number>(constantPoolCount);

        for (let i = 1; i < constantPoolCount; i++) {
            if (offset >= buffer.length) break;

            const tag = buffer.readUInt8(offset);
            offset += 1;
            cpTypes[i] = tag;

            switch (tag) {
                case ClassParser.CONSTANT_Utf8: {
                    const length = buffer.readUInt16BE(offset);
                    offset += 2;
                    if (offset + length <= buffer.length) {
                        cpStringData[i] = buffer.toString('utf8', offset, offset + length);
                    }
                    offset += length;
                    break;
                }
                case ClassParser.CONSTANT_Class:
                case ClassParser.CONSTANT_String:
                case ClassParser.CONSTANT_MethodType:
                case ClassParser.CONSTANT_Module:
                case ClassParser.CONSTANT_Package: {
                    const nameIndex = buffer.readUInt16BE(offset);
                    if (tag === ClassParser.CONSTANT_Class) {
                        cpClassIndices[i] = nameIndex;
                    }
                    offset += 2;
                    break;
                }
                case ClassParser.CONSTANT_Fieldref:
                case ClassParser.CONSTANT_Methodref:
                case ClassParser.CONSTANT_InterfaceMethodref:
                case ClassParser.CONSTANT_NameAndType:
                case ClassParser.CONSTANT_Dynamic:
                case ClassParser.CONSTANT_InvokeDynamic: {
                    offset += 4; // index1, index2
                    break;
                }
                case ClassParser.CONSTANT_Integer:
                case ClassParser.CONSTANT_Float: {
                    offset += 4;
                    break;
                }
                case ClassParser.CONSTANT_Long:
                case ClassParser.CONSTANT_Double: {
                    offset += 8;
                    i++; // Long and Double take up two entries in the constant pool
                    break;
                }
                case ClassParser.CONSTANT_MethodHandle: {
                    offset += 3; // reference_kind, reference_index
                    break;
                }
                default:
                    // Unknown or unsupported tag. We stop parsing to be safe.
                    return references;
            }
        }

        // We only care about CONSTANT_Class references.
        // Map class name index to actual Utf8 strings
        for (let i = 1; i < constantPoolCount; i++) {
            if (cpTypes[i] === ClassParser.CONSTANT_Class) {
                const nameIdx = cpClassIndices[i];
                if (nameIdx > 0 && nameIdx < constantPoolCount && cpTypes[nameIdx] === ClassParser.CONSTANT_Utf8) {
                    let className = cpStringData[nameIdx];
                    if (className) {
                        // Class names in the constant pool are formatted like: java/lang/Object
                        // Ignore arrays (start with '[')
                        if (className.startsWith('[')) {
                            // Extract base type of array if it's an object array: '[Ljava/lang/String;' -> 'java/lang/String'
                            const match = className.match(/\[*L([^;]+);/);
                            if (match && match[1]) {
                                className = match[1];
                            } else {
                                continue;
                            }
                        }
                        
                        // Exclude obvious standard JDK libraries to speed up subsequent matching
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

        return references;
    }
}
