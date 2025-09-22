import { GolemDBStorage } from '../storage/db-chain';
import { ChunkingService } from './chunking';
import { QuotaService } from './quota';
import { CONFIG, UploadSession, FileMetadata } from '../types';

export class UploadService {
  private storage = new GolemDBStorage();
  private quotaService = new QuotaService();
  private uploadSessions: Map<string, UploadSession> = new Map();

  async initiateUpload(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    idempotencyKey: string,
    userId: string,
    btlDays: number = CONFIG.DEFAULT_BTL_DAYS
  ): Promise<{ success: boolean; file_id?: string; error?: string }> {
    if (fileBuffer.length > CONFIG.MAX_FILE_SIZE) {
      return { success: false, error: `File too large. Max size: ${CONFIG.MAX_FILE_SIZE} bytes` };
    }

    if (!this.isValidFileType(contentType)) {
      return { success: false, error: `File type not supported: ${contentType}` };
    }

    const quotaCheck = await this.quotaService.checkQuota(userId, fileBuffer.length);
    if (!quotaCheck.allowed) {
      return { success: false, error: quotaCheck.reason };
    }

    const existingSession = this.findExistingSession(idempotencyKey);
    if (existingSession) {
      return { success: true, file_id: existingSession.file_id };
    }

    const file_id = ChunkingService.generateFileId();
    const expiration_block = this.storage.calculateExpirationBlock(btlDays);

    const metadata = ChunkingService.createMetadata(
      file_id,
      filename,
      contentType,
      fileBuffer,
      btlDays,
      expiration_block
    );

    const session: UploadSession = {
      file_id,
      idempotency_key: idempotencyKey,
      metadata,
      chunks_received: new Set(),
      completed: false
    };

    this.uploadSessions.set(idempotencyKey, session);

    const chunks = ChunkingService.chunkFile(fileBuffer, file_id, expiration_block);

    try {
      for (const chunk of chunks) {
        await this.storage.storeChunk(chunk);
        session.chunks_received.add(chunk.chunk_index);
      }

      await this.storage.storeMetadata(metadata);
      session.completed = true;

      await this.quotaService.updateUsage(userId, fileBuffer.length);

      return { success: true, file_id };
    } catch (error) {
      return { success: false, error: `Upload failed: ${error}` };
    }
  }

  async getFile(file_id: string): Promise<{ success: boolean; buffer?: Buffer; metadata?: FileMetadata; error?: string }> {
    try {
      const metadata = await this.storage.getMetadata(file_id);
      if (!metadata) {
        return { success: false, error: 'File not found or expired' };
      }

      const chunks = await this.storage.getAllChunks(file_id);
      if (chunks.length === 0) {
        return { success: false, error: 'File chunks not found or incomplete' };
      }

      const reassembledBuffer = ChunkingService.reassembleFile(chunks);

      if (!ChunkingService.validateFileIntegrity(metadata.checksum, reassembledBuffer)) {
        return { success: false, error: 'File integrity check failed' };
      }

      return { success: true, buffer: reassembledBuffer, metadata };
    } catch (error) {
      return { success: false, error: `Retrieval failed: ${error}` };
    }
  }

  private isValidFileType(contentType: string): boolean {
    return CONFIG.ALLOWED_FILE_TYPES.includes(contentType);
  }

  private findExistingSession(idempotencyKey: string): UploadSession | null {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getUploadStatus(idempotencyKey: string): Promise<UploadSession | null> {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getFilesByExtension(extension: string): Promise<FileMetadata[]> {
    const allMetadata: FileMetadata[] = [];

    for (const [_, metadata] of this.storage['metadata']) {
      if (metadata.file_extension === extension.toLowerCase()) {
        allMetadata.push(metadata);
      }
    }

    return allMetadata;
  }

  async getFilesByContentType(contentType: string): Promise<FileMetadata[]> {
    const allMetadata: FileMetadata[] = [];

    for (const [_, metadata] of this.storage['metadata']) {
      if (metadata.content_type === contentType) {
        allMetadata.push(metadata);
      }
    }

    return allMetadata;
  }
}