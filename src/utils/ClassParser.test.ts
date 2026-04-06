import * as fs from 'fs';
import { ClassParser } from './ClassParser';

jest.mock('fs');

describe('ClassParser', () => {
    const mockedFs = fs as jest.Mocked<typeof fs>;

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('should return an empty set if the file does not exist', () => {
        mockedFs.existsSync.mockReturnValue(false);

        const result = ClassParser.getReferencedClasses('nonexistent.class');
        expect(result.size).toBe(0);
        expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    it('should return an empty set if fs.readFileSync throws an error', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const result = ClassParser.getReferencedClasses('error.class');
        expect(result.size).toBe(0);
    });

    it('should return an empty set if the buffer length is less than 10', () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(Buffer.alloc(9));

        const result = ClassParser.getReferencedClasses('short.class');
        expect(result.size).toBe(0);
    });

    it('should return an empty set if the magic number is invalid', () => {
        mockedFs.existsSync.mockReturnValue(true);

        const buffer = Buffer.alloc(20);
        buffer.writeUInt32BE(0xCAFEBABF, 0); // Invalid magic number

        mockedFs.readFileSync.mockReturnValue(buffer);

        const result = ClassParser.getReferencedClasses('invalid-magic.class');
        expect(result.size).toBe(0);
    });

    function createMockClassBuffer(constantPool: any[]): Buffer {
        // Build the constant pool
        const buffers: Buffer[] = [];

        // Magic
        const magicBuf = Buffer.alloc(4);
        magicBuf.writeUInt32BE(0xCAFEBABE, 0);
        buffers.push(magicBuf);

        // Minor / Major Version
        const versionBuf = Buffer.alloc(4);
        buffers.push(versionBuf);

        // Constant Pool Count
        const cpCountBuf = Buffer.alloc(2);
        const constantPoolCount = constantPool.length + 1; // +1 because index 0 is skipped
        cpCountBuf.writeUInt16BE(constantPoolCount, 0);
        buffers.push(cpCountBuf);

        // Constant Pool Entries
        for (const entry of constantPool) {
            const entryBuf = Buffer.alloc(entry.size);
            entryBuf.writeUInt8(entry.tag, 0);

            if (entry.tag === 1) { // CONSTANT_Utf8
                const strBuf = Buffer.from(entry.value, 'utf8');
                entryBuf.writeUInt16BE(strBuf.length, 1);
                strBuf.copy(entryBuf, 3);
            } else if (entry.tag === 7) { // CONSTANT_Class
                entryBuf.writeUInt16BE(entry.nameIndex, 1);
            } else {
                // We'll fill other tags with zeros for simplicity
            }

            buffers.push(entryBuf);
        }

        return Buffer.concat(buffers);
    }

    it('should parse CONSTANT_Class and CONSTANT_Utf8 correctly', () => {
        mockedFs.existsSync.mockReturnValue(true);

        const className = 'com/example/MyClass';
        const strBuf = Buffer.from(className, 'utf8');

        // Tag 1 (Utf8)
        const cp1 = { tag: 1, size: 3 + strBuf.length, value: className };
        // Tag 7 (Class) pointing to cp index 1
        const cp2 = { tag: 7, size: 3, nameIndex: 1 };

        const buffer = createMockClassBuffer([cp1, cp2]);
        mockedFs.readFileSync.mockReturnValue(buffer as any);

        const result = ClassParser.getReferencedClasses('valid.class');
        expect(result.size).toBe(1);
        expect(result.has(className)).toBe(true);
    });

    it('should exclude standard JDK classes', () => {
        mockedFs.existsSync.mockReturnValue(true);

        const classesToExclude = ['java/lang/String', 'javax/servlet/http/HttpServlet', 'sun/misc/Unsafe', 'jdk/internal/reflect/Reflection'];
        const cpEntries: any[] = [];

        let index = 1;
        for (const cls of classesToExclude) {
            const strBuf = Buffer.from(cls, 'utf8');
            cpEntries.push({ tag: 1, size: 3 + strBuf.length, value: cls }); // Utf8
            cpEntries.push({ tag: 7, size: 3, nameIndex: index }); // Class
            index += 2;
        }

        const buffer = createMockClassBuffer(cpEntries);
        mockedFs.readFileSync.mockReturnValue(buffer as any);

        const result = ClassParser.getReferencedClasses('jdk.class');
        expect(result.size).toBe(0);
    });

    it('should handle array descriptors and extract base type', () => {
        mockedFs.existsSync.mockReturnValue(true);

        const arrayDesc = '[Lcom/example/ArrayType;';
        const primitiveArrayDesc = '[I';

        const strBuf1 = Buffer.from(arrayDesc, 'utf8');
        const cp1 = { tag: 1, size: 3 + strBuf1.length, value: arrayDesc };
        const cp2 = { tag: 7, size: 3, nameIndex: 1 };

        const strBuf2 = Buffer.from(primitiveArrayDesc, 'utf8');
        const cp3 = { tag: 1, size: 3 + strBuf2.length, value: primitiveArrayDesc };
        const cp4 = { tag: 7, size: 3, nameIndex: 3 };

        const buffer = createMockClassBuffer([cp1, cp2, cp3, cp4]);
        mockedFs.readFileSync.mockReturnValue(buffer as any);

        const result = ClassParser.getReferencedClasses('array.class');
        expect(result.size).toBe(1);
        expect(result.has('com/example/ArrayType')).toBe(true);
    });

    it('should stop parsing gracefully and return empty references on unknown tags', () => {
        mockedFs.existsSync.mockReturnValue(true);

        const className = 'com/example/BeforeUnknown';
        const strBuf = Buffer.from(className, 'utf8');

        const cp1 = { tag: 1, size: 3 + strBuf.length, value: className };
        const cp2 = { tag: 7, size: 3, nameIndex: 1 };
        const cp3 = { tag: 99, size: 1 }; // Unknown tag

        const buffer = createMockClassBuffer([cp1, cp2, cp3]);
        mockedFs.readFileSync.mockReturnValue(buffer as any);

        const result = ClassParser.getReferencedClasses('unknown-tag.class');
        // Because of the early return on line 128, it won't reach the loop on line 134 to populate references
        expect(result.size).toBe(0);
    });
});
