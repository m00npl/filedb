import crypto from 'crypto';
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
      const chunkData = fileBuffer.subarray(i, i + chunkSize);
      const chunk_index = Math.floor(i / chunkSize);

      const chunk: ChunkEntity = {
        id: crypto.randomUUID(),
        file_id,
        chunk_index,
        data: chunkData,
        checksum: this.calculateChecksum(chunkData),
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

    const buffers = chunks.map(chunk => chunk.data);
    return Buffer.concat(buffers);
  }

  static validateFileIntegrity(originalChecksum: string, reassembledBuffer: Buffer): boolean {
    const reassembledChecksum = this.calculateChecksum(reassembledBuffer);
    return originalChecksum === reassembledChecksum;
  }
}