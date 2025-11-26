import type { HonoRequest } from "hono"
import {
  chunkFile,
  createMetadata,
  generateFileId,
  reassembleFile,
  validateFileIntegrity,
} from "@/services/chunking"
import { QuotaService } from "@/services/quota"
import { RedisSessionStore } from "@/services/redis-session-store"
import type { IStorage } from "@/storage/storage-factory"
import {
  type ChunkEntity,
  CONFIG,
  type FileMetadata,
  type UploadSession,
  UploadStatus,
} from "@/types"

export class UploadService {
  private storage!: IStorage
  private quotaService!: QuotaService
  private sessionStore!: RedisSessionStore
  private uploadSessions: Map<string, UploadSession> = new Map() // Fallback for Redis failures
  private initialized = false

  async initialize(storage: IStorage): Promise<void> {
    if (this.initialized) return

    this.storage = storage
    this.quotaService = new QuotaService(this.storage)

    // Initialize Redis session store
    this.sessionStore = new RedisSessionStore()
    try {
      await this.sessionStore.initialize()
      console.log("✅ Redis session store initialized")
    } catch (error) {
      console.warn("⚠️ Redis not available, using in-memory sessions as fallback")
      console.warn("Error:", error)
    }

    this.initialized = true
  }

  async initiateUpload(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    idempotencyKey: string,
    userId: string,
    btlDays: number = CONFIG.DEFAULT_BTL_DAYS,
    owner?: string,
    request?: HonoRequest,
  ): Promise<{ success: boolean; file_id?: string; error?: string }> {
    if (fileBuffer.length > CONFIG.MAX_FILE_SIZE) {
      return { success: false, error: `File too large. Max size: ${CONFIG.MAX_FILE_SIZE} bytes` }
    }

    if (!this.isValidFileType(contentType)) {
      return { success: false, error: `File type not supported: ${contentType}` }
    }

    const quotaCheck = await this.quotaService.checkQuota(userId, fileBuffer.length, request)
    if (!quotaCheck.allowed) {
      return { success: false, error: quotaCheck.reason }
    }

    const existingSession = await this.findExistingSession(idempotencyKey)
    if (existingSession) {
      return { success: true, file_id: existingSession.file_id }
    }

    const file_id = generateFileId()
    const expiration_block = this.storage.calculateExpirationBlock(btlDays)

    const metadata = createMetadata(
      file_id,
      filename,
      contentType,
      fileBuffer,
      btlDays,
      expiration_block,
    )

    // Add owner annotation if provided
    if (owner) {
      metadata.owner = owner
    }

    const chunks = chunkFile(fileBuffer, file_id, expiration_block)

    const session: UploadSession = {
      file_id,
      idempotency_key: idempotencyKey,
      metadata,
      chunks_received: new Set(),
      completed: false,
      status: UploadStatus.UPLOADING,
      chunks_uploaded_to_blockchain: 0,
      total_chunks: chunks.length,
      started_at: new Date(),
    }

    // Store session in Redis with fallback to in-memory
    if (this.sessionStore && this.sessionStore.isRedisConnected()) {
      try {
        await this.sessionStore.setSession(idempotencyKey, session, 7200) // 2 hours TTL
        console.log(`💾 Session ${idempotencyKey} stored in Redis`)
      } catch (error) {
        console.warn("⚠️ Failed to store session in Redis, using in-memory fallback:", error)
        this.uploadSessions.set(idempotencyKey, session)
      }
    } else {
      this.uploadSessions.set(idempotencyKey, session)
    }

    // Update quota asynchronously (don't block response)
    this.quotaService.updateUsage(userId, fileBuffer.length).catch((error) => {
      console.error(`⚠️ Failed to update quota for user ${userId}:`, error)
      // Quota update failure is not critical - the file was already accepted
    })

    // Start asynchronous blockchain upload (don't wait for it)
    this.uploadToBlockchainAsync(chunks, metadata, session).catch((error) => {
      console.error(`❌ Async upload failed for file ${file_id}:`, error)
      session.status = UploadStatus.FAILED
      session.error = `Blockchain upload failed: ${error}`
    })

    return { success: true, file_id }
  }

  async getFile(
    file_id: string,
  ): Promise<{ success: boolean; buffer?: Buffer; metadata?: FileMetadata; error?: string }> {
    try {
      // Get metadata (with entity key if available for fast path)
      const metadata = await this.storage.getMetadata(file_id)

      if (!metadata) {
        return { success: false, error: "File not found or expired" }
      }

      // Get chunks (with entity key if available for fast path)
      const chunks = await this.storage.getAllChunks(file_id)

      if (chunks.length === 0) {
        return { success: false, error: "File chunks not found or incomplete" }
      }

      const reassembledBuffer = reassembleFile(chunks)

      if (!validateFileIntegrity(metadata.checksum, reassembledBuffer)) {
        return { success: false, error: "File integrity check failed" }
      }

      return { success: true, buffer: reassembledBuffer, metadata }
    } catch (error) {
      return { success: false, error: `Retrieval failed: ${error}` }
    }
  }

  private isValidFileType(contentType: string): boolean {
    const baseType = contentType.split(";")[0]?.trim() as string
    return CONFIG.ALLOWED_FILE_TYPES.includes(baseType)
  }

  private async findExistingSession(idempotencyKey: string): Promise<UploadSession | null> {
    // Try Redis first, then fallback to in-memory
    if (this.sessionStore && this.sessionStore.isRedisConnected()) {
      try {
        const session = await this.sessionStore.getSession(idempotencyKey)
        if (session) return session
      } catch (error) {
        console.warn("⚠️ Failed to get session from Redis:", error)
      }
    }
    return this.uploadSessions.get(idempotencyKey) || null
  }

  async getUploadStatus(idempotencyKey: string): Promise<UploadSession | null> {
    return await this.findExistingSession(idempotencyKey)
  }

  async getUploadStatusByFileId(file_id: string): Promise<UploadSession | null> {
    // Try Redis first
    if (this.sessionStore && this.sessionStore.isRedisConnected()) {
      try {
        const sessions = await this.sessionStore.getSessionsByFileId(file_id)
        if (sessions.length > 0) return sessions[0] as UploadSession
      } catch (error) {
        console.warn("⚠️ Failed to get session by file ID from Redis:", error)
      }
    }

    // Fallback to in-memory search
    for (const session of this.uploadSessions.values()) {
      if (session.file_id === file_id) {
        return session
      }
    }
    return null
  }

  async getFilesByExtension(extension: string): Promise<FileMetadata[]> {
    try {
      const allMetadata = this.storage.getAllMetadata()
      const metadataArray = Array.isArray(allMetadata) ? allMetadata : await allMetadata

      return metadataArray.filter((metadata) => metadata.file_extension === extension.toLowerCase())
    } catch (error) {
      // Blockchain storage doesn't support getAllMetadata
      console.warn("⚠️  Query by extension not supported in current storage mode:", error)
      return []
    }
  }

  async getFilesByContentType(contentType: string): Promise<FileMetadata[]> {
    try {
      const allMetadata = this.storage.getAllMetadata()
      const metadataArray = Array.isArray(allMetadata) ? allMetadata : await allMetadata

      return metadataArray.filter((metadata) => metadata.content_type === contentType)
    } catch (error) {
      // Blockchain storage doesn't support getAllMetadata
      console.warn("⚠️  Query by content type not supported in current storage mode:", error)
      return []
    }
  }

  async getFilesByOwner(owner: string): Promise<FileMetadata[]> {
    // For Arkiv storage, we need to use the storage layer method
    if (this.storage.getFilesByOwner) {
      return await this.storage.getFilesByOwner(owner)
    }

    // Fallback for in-memory storage
    const allMetadata = this.storage.getAllMetadata()
    const metadataArray = Array.isArray(allMetadata) ? allMetadata : await allMetadata

    return metadataArray.filter((metadata) => metadata.owner === owner)
  }

  async getFileEntityKeys(
    file_id: string,
  ): Promise<{ metadata_key?: string; chunk_keys: string[] }> {
    // Try Redis cache first (fast)
    if (this.sessionStore && this.sessionStore.isRedisConnected()) {
      try {
        const cachedKeys = await this.sessionStore.getFileEntityKeys(file_id)
        if (cachedKeys) {
          console.log(`✨ Retrieved entity keys from cache for file ${file_id}`)
          return cachedKeys
        }
      } catch (error) {
        console.warn("⚠️ Failed to get entity keys from cache:", error)
      }
    }

    // Fallback to blockchain query (slow) with timeout
    if (this.storage.getFileEntityKeys) {
      console.log(`🔍 Querying blockchain for entity keys for file ${file_id}`)

      const timeout = 5000
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Blockchain entity keys query timed out")), timeout)
      })

      try {
        return (await Promise.race([
          this.storage.getFileEntityKeys(file_id),
          timeoutPromise,
        ])) as any
      } catch (error) {
        console.warn(`⚠️ Blockchain entity keys query timed out for file ${file_id}`)
        return { chunk_keys: [] }
      }
    }

    // Final fallback for in-memory storage
    return { chunk_keys: [] }
  }

  private async uploadToBlockchainAsync(
    chunks: ChunkEntity[],
    metadata: FileMetadata,
    session: UploadSession,
  ): Promise<void> {
    console.log(
      `🚀 Starting async blockchain upload for file ${session.file_id} (${chunks.length} chunks)`,
    )

    try {
      // Fallback to individual uploads
      console.log(`🔄 Using individual upload method for file ${session.file_id}`)

      // Upload chunks with retry mechanism
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]

        try {
          await this.storage.storeChunk(chunk)
          session.chunks_received.add(chunk?.chunk_index ?? 0)
          session.chunks_uploaded_to_blockchain = i + 1
          session.last_chunk_uploaded_at = new Date()

          console.log(`📦 Uploaded chunk ${i + 1}/${chunks.length} for file ${session.file_id}`)
        } catch (error) {
          console.error(`❌ Failed to upload chunk ${i} for file ${session.file_id}:`, error)
          throw new Error(`Chunk ${i} upload failed: ${error}`)
        }
      }

      // Upload metadata
      await this.storage.storeMetadata(metadata)

      // Extract and cache entity keys
      const entityKeys = {
        metadata_key: metadata.entity_key,
        chunk_keys: chunks.map((c) => c.entity_key).filter((k): k is string => k !== undefined),
      }

      // Save entity keys to Redis cache with 7 day TTL
      if (this.sessionStore && this.sessionStore.isRedisConnected()) {
        try {
          await this.sessionStore.setFileEntityKeys(session.file_id, entityKeys, 7 * 24 * 3600)
          console.log(
            `💾 Cached entity keys for file ${session.file_id}: metadata=${entityKeys.metadata_key}, chunks=${entityKeys.chunk_keys.length}`,
          )
        } catch (error) {
          console.warn("⚠️ Failed to cache entity keys in Redis:", error)
        }
      }

      // Mark as completed
      session.completed = true
      session.status = UploadStatus.COMPLETED

      console.log(`✅ Completed blockchain upload for file ${session.file_id}`)
    } catch (error) {
      session.status = UploadStatus.FAILED
      session.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }
}
