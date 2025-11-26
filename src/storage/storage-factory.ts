import type { ChunkEntity, FileMetadata } from "../types"
import { CONFIG } from "../types"
import { ArkivStorage } from "./arkiv-storage"
import { ArkivMemoryStorage as MemoryStorage } from "./db-chain"

export interface IStorage {
  storeChunk(chunk: any): Promise<void>
  getChunk(file_id: string, chunk_index: number): Promise<ChunkEntity | null>
  storeMetadata(metadata: FileMetadata): Promise<void>
  getMetadata(file_id: string): Promise<FileMetadata | null>
  getAllChunks(file_id: string): Promise<ChunkEntity[]>
  getCurrentBlock(): Promise<number> | number
  calculateExpirationBlock(btl_days: number): number
  getUserQuota?(userAddress: string): Promise<{ used_bytes: number; uploads_today: number }>
  updateUserQuota?(userAddress: string, addedBytes: number): Promise<void>
  getFilesByOwner?(owner: string): Promise<FileMetadata[]>
  getFileEntityKeys?(file_id: string): Promise<{ metadata_key?: string; chunk_keys: string[] }>
  storeBatch?(
    metadata: FileMetadata,
    chunks: ChunkEntity[],
  ): Promise<{ metadata_key: string; chunk_keys: string[] }>
  storeBatchChunks?(chunks: ChunkEntity[]): Promise<string[]>
  getAllMetadata(): Promise<FileMetadata[]> | FileMetadata[]
}

export async function createStorage(): Promise<IStorage> {
  if (CONFIG.STORAGE_MODE === "arkiv") {
    console.log("🔗 Using Arkiv blockchain storage...")
    return new ArkivStorage()
  } else {
    console.log("💾 Using in-memory storage...")
    return new MemoryStorage()
  }
}
