import crypto from "crypto"
import type { ChunkEntity, FileMetadata } from "../types"

export class ArkivMemoryStorage {
  private chunks: Map<string, ChunkEntity> = new Map()
  private metadata: Map<string, FileMetadata> = new Map()
  private currentBlock = 1000000 // Mock current block

  async storeChunk(chunk: ChunkEntity): Promise<void> {
    const key = `${chunk.file_id}_${chunk.chunk_index}`

    if (this.chunks.has(key)) {
      const existing = this.chunks.get(key)!
      if (existing.checksum !== chunk.checksum) {
        throw new Error("Chunk checksum mismatch - data corruption detected")
      }
      return
    }

    this.chunks.set(key, chunk)
  }

  async getChunk(file_id: string, chunk_index: number): Promise<ChunkEntity | null> {
    const key = `${file_id}_${chunk_index}`
    const chunk = this.chunks.get(key)

    if (!chunk) return null

    if (chunk.expiration_block <= this.getCurrentBlock()) {
      this.chunks.delete(key)
      return null
    }

    return chunk
  }

  async storeMetadata(metadata: FileMetadata): Promise<void> {
    this.metadata.set(metadata.file_id, metadata)
  }

  async getMetadata(file_id: string, _metadataEntityKey?: string): Promise<FileMetadata | null> {
    const meta = this.metadata.get(file_id)

    if (!meta) return null

    if (meta.expiration_block <= this.getCurrentBlock()) {
      this.metadata.delete(file_id)
      return null
    }

    return meta
  }

  async getAllChunks(file_id: string, _chunkEntityKeys?: string[]): Promise<ChunkEntity[]> {
    const chunks: ChunkEntity[] = []
    const meta = await this.getMetadata(file_id)

    if (!meta) return []

    for (let i = 0; i < meta.chunk_count; i++) {
      const chunk = await this.getChunk(file_id, i)
      if (!chunk) return [] // Missing chunk means file is incomplete
      chunks.push(chunk)
    }

    return chunks
  }

  getAllMetadata(): FileMetadata[] {
    return Array.from(this.metadata.values())
  }

  getCurrentBlock(): number {
    return this.currentBlock
  }

  calculateExpirationBlock(btl_days: number): number {
    const blocksToAdd = btl_days * 2880 // 2880 blocks per day for Arkiv
    return this.getCurrentBlock() + blocksToAdd
  }
}
