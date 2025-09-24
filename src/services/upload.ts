import { StorageFactory, IStorage } from '../storage/storage-factory';
import { ChunkingService } from './chunking';
import { QuotaService } from './quota';
import { CONFIG, UploadSession, FileMetadata, UploadStatus } from '../types';

export class UploadService {
  private storage!: IStorage;
  private quotaService!: QuotaService;
  private uploadSessions: Map<string, UploadSession> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.storage = await StorageFactory.createStorage();
    this.quotaService = new QuotaService(this.storage);
    this.initialized = true;
  }

  async initiateUpload(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    idempotencyKey: string,
    userId: string,
    btlDays: number = CONFIG.DEFAULT_BTL_DAYS,
    owner?: string,
    request?: any
  ): Promise<{ success: boolean; file_id?: string; error?: string }> {
    await this.initialize();
    if (fileBuffer.length > CONFIG.MAX_FILE_SIZE) {
      return { success: false, error: `File too large. Max size: ${CONFIG.MAX_FILE_SIZE} bytes` };
    }

    if (!this.isValidFileType(contentType)) {
      return { success: false, error: `File type not supported: ${contentType}` };
    }

    const quotaCheck = await this.quotaService.checkQuota(userId, fileBuffer.length, request);
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

    // Add owner annotation if provided
    if (owner) {
      metadata.owner = owner;
    }

    const chunks = ChunkingService.chunkFile(fileBuffer, file_id, expiration_block);

    const session: UploadSession = {
      file_id,
      idempotency_key: idempotencyKey,
      metadata,
      chunks_received: new Set(),
      completed: false,
      status: UploadStatus.UPLOADING,
      chunks_uploaded_to_blockchain: 0,
      total_chunks: chunks.length,
      started_at: new Date()
    };

    this.uploadSessions.set(idempotencyKey, session);

    // Update quota immediately since we accepted the file
    await this.quotaService.updateUsage(userId, fileBuffer.length);

    // Start asynchronous blockchain upload (don't wait for it)
    this.uploadToBlockchainAsync(chunks, metadata, session).catch(error => {
      console.error(`❌ Async upload failed for file ${file_id}:`, error);
      session.status = UploadStatus.FAILED;
      session.error = `Blockchain upload failed: ${error}`;
    });

    return { success: true, file_id };
  }

  async getFile(file_id: string): Promise<{ success: boolean; buffer?: Buffer; metadata?: FileMetadata; error?: string }> {
    await this.initialize();
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
    const baseType = contentType.split(';')[0].trim();
    return CONFIG.ALLOWED_FILE_TYPES.includes(baseType);
  }

  private findExistingSession(idempotencyKey: string): UploadSession | null {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getUploadStatus(idempotencyKey: string): Promise<UploadSession | null> {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getUploadStatusByFileId(file_id: string): Promise<UploadSession | null> {
    for (const session of this.uploadSessions.values()) {
      if (session.file_id === file_id) {
        return session;
      }
    }
    return null;
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

  async getFilesByOwner(owner: string): Promise<FileMetadata[]> {
    await this.initialize();

    // For Golem DB storage, we need to use the storage layer method
    if (this.storage.getFilesByOwner) {
      return await this.storage.getFilesByOwner(owner);
    }

    // Fallback for in-memory storage
    const allMetadata: FileMetadata[] = [];

    for (const [_, metadata] of this.storage['metadata'] || []) {
      if (metadata.owner === owner) {
        allMetadata.push(metadata);
      }
    }

    return allMetadata;
  }

  async getFileEntityKeys(file_id: string): Promise<{ metadata_key?: string; chunk_keys: string[] }> {
    await this.initialize();

    if (this.storage.getFileEntityKeys) {
      return await this.storage.getFileEntityKeys(file_id);
    }

    // Fallback for in-memory storage
    return { chunk_keys: [] };
  }

  private async uploadToBlockchainAsync(
    chunks: any[],
    metadata: FileMetadata,
    session: UploadSession
  ): Promise<void> {
    console.log(`🚀 Starting async blockchain upload for file ${session.file_id} (${chunks.length} chunks)`);

    try {
      // Upload chunks with retry mechanism
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
          await this.storage.storeChunk(chunk);
          session.chunks_received.add(chunk.chunk_index);
          session.chunks_uploaded_to_blockchain = i + 1;
          session.last_chunk_uploaded_at = new Date();

          console.log(`📦 Uploaded chunk ${i + 1}/${chunks.length} for file ${session.file_id}`);
        } catch (error) {
          console.error(`❌ Failed to upload chunk ${i} for file ${session.file_id}:`, error);
          throw new Error(`Chunk ${i} upload failed: ${error}`);
        }
      }

      // Upload metadata
      await this.storage.storeMetadata(metadata);

      // Mark as completed
      session.completed = true;
      session.status = UploadStatus.COMPLETED;

      console.log(`✅ Completed blockchain upload for file ${session.file_id}`);
    } catch (error) {
      session.status = UploadStatus.FAILED;
      session.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}