import * as crypto from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { CONFIG, ChunkEntity, FileMetadata } from '../types';

export class ChunkingService {
  static generateFileId(): string {
    return crypto.randomUUID();
  }

  static calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static chunkFile(fileBuffer: Buffer, file_id: string, expiration_block: number): ChunkEntity[] {
    const chunks: ChunkEntity[] = [];
    const chunkSize = CONFIG.CHUNK_SIZE;

    for (let i = 0; i < fileBuffer.length; i += chunkSize) {
      const rawChunkData = fileBuffer.subarray(i, i + chunkSize);
      const chunk_index = Math.floor(i / chunkSize);

      // Compress chunk data
      const compressedData = gzipSync(rawChunkData);

      // Log compression ratio for debugging
      const compressionRatio = ((rawChunkData.length - compressedData.length) / rawChunkData.length * 100).toFixed(1);
      console.log(`📦 Chunk ${chunk_index}: ${rawChunkData.length}B → ${compressedData.length}B (${compressionRatio}% compression)`);

      const chunk: ChunkEntity = {
        id: crypto.randomUUID(),
        file_id,
        chunk_index,
        data: compressedData,
        original_size: rawChunkData.length,
        compressed_size: compressedData.length,
        checksum: this.calculateChecksum(rawChunkData), // Checksum of original data
        created_at: new Date(),
        expiration_block
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  static createMetadata(
    file_id: string,
    original_filename: string,
    content_type: string,
    fileBuffer: Buffer,
    btl_days: number,
    expiration_block: number
  ): FileMetadata {
    const chunk_count = Math.ceil(fileBuffer.length / CONFIG.CHUNK_SIZE);
    const file_extension = this.extractFileExtension(original_filename);

    return {
      file_id,
      original_filename,
      content_type,
      file_extension,
      total_size: fileBuffer.length,
      chunk_count,
      checksum: this.calculateChecksum(fileBuffer),
      created_at: new Date(),
      expiration_block,
      btl_days
    };
  }

  static extractFileExtension(filename: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex > 0 ? filename.substring(lastDotIndex + 1).toLowerCase() : '';
  }

  static reassembleFile(chunks: ChunkEntity[]): Buffer {
    chunks.sort((a, b) => a.chunk_index - b.chunk_index);

    const buffers = chunks.map(chunk => {
      // Decompress chunk data
      const decompressedData = gunzipSync(chunk.data);
      console.log(`📤 Decompressing chunk ${chunk.chunk_index}: ${chunk.data.length}B → ${decompressedData.length}B`);
      return decompressedData;
    });

    return Buffer.concat(buffers);
  }

  static validateFileIntegrity(originalChecksum: string, reassembledBuffer: Buffer): boolean {
    const reassembledChecksum = this.calculateChecksum(reassembledBuffer);
    return originalChecksum === reassembledChecksum;
  }
}