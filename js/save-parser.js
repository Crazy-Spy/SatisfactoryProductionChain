/**
 * Satisfactory Save Game (.sav) Client-Side Parser
 * Reads and decompresses Satisfactory save files directly in the browser.
 * Extracts session metadata and all available/unlocked recipes (mAvailableRecipes).
 */

const SaveParser = (function () {
    'use strict';

    /**
     * Binary reader helper for ArrayBuffer
     */
    class BinaryReader {
        constructor(buffer) {
            if (buffer instanceof ArrayBuffer) {
                this.arrayBuffer = buffer;
                this.byteOffset = 0;
                this.byteLength = buffer.byteLength;
            } else if (ArrayBuffer.isView(buffer)) {
                this.arrayBuffer = buffer.buffer;
                this.byteOffset = buffer.byteOffset;
                this.byteLength = buffer.byteLength;
            } else {
                throw new Error('Unsupported buffer type for BinaryReader');
            }
            this.view = new DataView(this.arrayBuffer, this.byteOffset, this.byteLength);
            this.uint8Array = new Uint8Array(this.arrayBuffer, this.byteOffset, this.byteLength);
            this.offset = 0;
            this.textDecoderUtf8 = new TextDecoder('utf-8');
            this.textDecoderUtf16 = new TextDecoder('utf-16le');
        }

        get remaining() {
            return this.byteLength - this.offset;
        }

        readInt32() {
            const val = this.view.getInt32(this.offset, true);
            this.offset += 4;
            return val;
        }

        readUInt32() {
            const val = this.view.getUint32(this.offset, true);
            this.offset += 4;
            return val;
        }

        readInt64() {
            const val = this.view.getBigInt64(this.offset, true);
            this.offset += 8;
            return Number(val);
        }

        readUInt8() {
            const val = this.view.getUint8(this.offset);
            this.offset += 1;
            return val;
        }

        readBytes(length) {
            const slice = this.uint8Array.subarray(this.offset, this.offset + length);
            this.offset += length;
            return slice;
        }

        readFString() {
            if (this.remaining < 4) return '';
            const length = this.readInt32();
            if (length === 0) return '';

            if (length < 0) {
                // UTF-16LE string (negative length in Unreal Engine)
                const byteLength = (-length) * 2;
                if (this.remaining < byteLength) {
                    this.offset = this.byteLength;
                    return '';
                }
                const bytes = this.readBytes(byteLength);
                // Exclude terminating null character (2 bytes)
                return this.textDecoderUtf16.decode(bytes.subarray(0, byteLength - 2));
            } else {
                // UTF-8 / ASCII string
                if (this.remaining < length) {
                    this.offset = this.byteLength;
                    return '';
                }
                const bytes = this.readBytes(length);
                // Exclude terminating null character (1 byte)
                return this.textDecoderUtf8.decode(bytes.subarray(0, length - 1));
            }
        }
    }

    /**
     * Parse Save Header metadata
     */
    function parseHeader(reader) {
        const header = {};
        header.headerVersion = reader.readInt32();
        header.saveVersion = reader.readInt32();
        header.buildVersion = reader.readInt32();

        if (header.headerVersion >= 14) {
            header.saveName = reader.readFString();
        }

        header.mapName = reader.readFString();
        header.mapOptions = reader.readFString();

        if (header.headerVersion >= 4) {
            header.sessionName = reader.readFString();
        }

        if (header.headerVersion >= 3) {
            header.playDurationSeconds = reader.readInt32();
        } else {
            header.playDurationSeconds = 0;
        }

        if (header.headerVersion >= 4) {
            header.saveDateTime = reader.readInt64();
        }

        if (header.headerVersion >= 5) {
            header.sessionVisibility = reader.readUInt8();
        }

        if (header.headerVersion >= 7) {
            header.editorObjectVersion = reader.readInt32();
        }

        if (header.headerVersion >= 8) {
            header.modMetadata = reader.readFString();
            header.isModdedSave = reader.readInt32() !== 0;
        }

        if (header.headerVersion >= 10) {
            header.saveIdentifier = reader.readFString();
        }

        if (header.headerVersion >= 11) {
            // IsPartitionedWorld is int32 (4 bytes in UE header)
            header.isPartitionedWorld = reader.readInt32() !== 0;
        }

        if (header.headerVersion >= 12) {
            const hasMd5 = reader.readInt32() !== 0;
            if (hasMd5) {
                reader.readBytes(16); // MD5 hash
            }
        }

        if (header.headerVersion >= 13) {
            header.isCreativeModeEnabled = reader.readInt32() !== 0;
        }

        header.headerEndOffset = reader.offset;
        return header;
    }

    /**
     * Find PACKAGE_FILE_TAG magic constant (0x9E2A83C1 -> bytes: 0xC1, 0x83, 0x2A, 0x9E)
     */
    function findPackageFileTag(bytes, startOffset = 0) {
        const len = Math.min(bytes.length - 4, startOffset + 2048);
        for (let i = startOffset; i < len; i++) {
            if (bytes[i] === 0xC1 && bytes[i + 1] === 0x83 && bytes[i + 2] === 0x2A && bytes[i + 3] === 0x9E) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Decompress a single zlib chunk using native browser DecompressionStream
     */
    async function decompressChunk(chunkBytes) {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(chunkBytes);
        writer.close();

        const reader = ds.readable.getReader();
        const parts = [];
        let total = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            total += value.length;
        }

        if (parts.length === 1) return parts[0];
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) {
            merged.set(p, offset);
            offset += p.length;
        }
        return merged;
    }

    /**
     * Formats duration in seconds into human-readable hours and minutes (e.g. "131h 9m")
     */
    function formatPlayDuration(seconds) {
        if (!seconds || seconds <= 0) return '0m';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    }

    /**
     * Decompresses all save chunks and searches for mAvailableRecipes
     */
    async function parseSaveFile(arrayBuffer, onProgress = null) {
        const fullBytes = new Uint8Array(arrayBuffer);
        const reader = new BinaryReader(arrayBuffer);

        // 1. Read Header
        const header = parseHeader(reader);

        // 2. Locate Chunk start
        const chunkStart = findPackageFileTag(fullBytes, header.headerEndOffset || 0);
        if (chunkStart === -1) {
            throw new Error('Invalid Satisfactory save file: PACKAGE_FILE_TAG not found.');
        }

        reader.offset = chunkStart;
        const decompressedChunks = [];
        let totalDecompressedBytes = 0;
        let chunkIndex = 0;

        // Estimate chunk count based on remaining file size (average compressed chunk ~50KB)
        const estTotalChunks = Math.max(1, Math.round(reader.remaining / 50000));

        // 3. Decompress chunks sequentially
        while (reader.remaining >= 48) {
            const tag = reader.readUInt32();
            if (tag !== 0x9E2A83C1) {
                // End of chunks
                break;
            }

            const archiveHeader = reader.readUInt32();
            const maxChunkSize = reader.readInt64();
            if (archiveHeader === 0x22222222) {
                reader.readUInt8(); // CompressorNum (3 = zlib)
            }

            const compSummary = reader.readInt64();
            const uncompSummary = reader.readInt64();
            const compSize = reader.readInt64();
            const uncompSize = reader.readInt64();

            if (reader.remaining < compSize) {
                break;
            }

            const chunkCompressed = reader.readBytes(compSize);
            const decompressed = await decompressChunk(chunkCompressed);
            decompressedChunks.push(decompressed);
            totalDecompressedBytes += decompressed.length;
            chunkIndex++;

            if (onProgress && chunkIndex % 15 === 0) {
                onProgress({
                    phase: 'decompressing',
                    chunkIndex,
                    estimatedTotal: estTotalChunks,
                    percent: Math.min(95, Math.round((chunkIndex / estTotalChunks) * 100))
                });
            }
        }

        if (onProgress) {
            onProgress({ phase: 'analyzing', percent: 98 });
        }

        // 4. Merge decompressed chunks into a single buffer
        const mergedBuffer = new Uint8Array(totalDecompressedBytes);
        let writeOffset = 0;
        for (const chunk of decompressedChunks) {
            mergedBuffer.set(chunk, writeOffset);
            writeOffset += chunk.length;
        }

        // 5. Locate "mAvailableRecipes\0"
        const targetAscii = 'mAvailableRecipes\0';
        const targetBytes = new TextEncoder().encode(targetAscii);
        let matchOffset = -1;

        // Search for targetBytes in mergedBuffer
        for (let i = 0; i <= mergedBuffer.length - targetBytes.length; i++) {
            let matched = true;
            for (let j = 0; j < targetBytes.length; j++) {
                if (mergedBuffer[i + j] !== targetBytes[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                matchOffset = i;
                break;
            }
        }

        if (matchOffset === -1) {
            throw new Error('mAvailableRecipes property not found in decompressed save data.');
        }

        // 6. Parse mAvailableRecipes ArrayProperty
        // Count is located at matchOffset + 0x44 (68 bytes)
        const dView = new DataView(mergedBuffer.buffer, mergedBuffer.byteOffset + matchOffset + 0x44);
        let arrayOffset = 0;
        const count = dView.getInt32(arrayOffset, true);
        arrayOffset += 4;

        const decompReader = new BinaryReader(mergedBuffer.subarray(matchOffset + 0x44 + arrayOffset));

        const allAvailableRecipes = [];
        const unlockedAlternateRecipes = [];
        const unlockedRecipeIds = new Set();

        for (let i = 0; i < count; i++) {
            const levelName = decompReader.readFString();
            const pathName = decompReader.readFString();

            // Extract Recipe class name (e.g. /Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C -> Recipe_IngotIron_C)
            const match = pathName.match(/([A-Za-z0-9_]+)$/);
            const recipeId = match ? match[1] : pathName;

            allAvailableRecipes.push(recipeId);
            unlockedRecipeIds.add(recipeId);
            if (recipeId.endsWith('_C')) {
                unlockedRecipeIds.add(recipeId.slice(0, -2));
            } else {
                unlockedRecipeIds.add(recipeId + '_C');
            }

            if (recipeId.includes('Alternate')) {
                unlockedAlternateRecipes.push(recipeId);
            }
        }

        if (onProgress) {
            onProgress({ phase: 'done', percent: 100 });
        }

        return {
            sessionName: header.sessionName || 'Satisfactory World',
            saveName: header.saveName || '',
            playDurationSeconds: header.playDurationSeconds || 0,
            playDurationFormatted: formatPlayDuration(header.playDurationSeconds || 0),
            buildVersion: header.buildVersion || 0,
            saveDateTime: header.saveDateTime ? new Date(Number((BigInt(header.saveDateTime) - 621355968000000000n) / 10000n)) : null,
            totalAvailableRecipes: count,
            unlockedAlternateRecipesCount: unlockedAlternateRecipes.length,
            unlockedAlternateRecipes: unlockedAlternateRecipes,
            unlockedRecipeIds: unlockedRecipeIds,
            rawHeader: header
        };
    }

    return {
        parseSaveFile,
        formatPlayDuration
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SaveParser;
}
