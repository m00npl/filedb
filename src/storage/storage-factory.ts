import { ArkivMemoryStorage as MemoryStorage } from './db-chain';
// import { ArkivStorage } from './arkiv-storage'; // Temporarily disabled - arkiv-sdk-js export issues
import { CONFIG } from '../types';

export interface IStorage {
  storeChunk(chunk: any): Promise<void>;
  getChunk(file_id: string, chunk_index: number): Promise<any>;
  storeMetadata(metadata: any): Promise<void>;
  getMetadata(file_id: string): Promise<any>;
  getAllChunks(file_id: string): Promise<any[]>;
  getCurrentBlock(): Promise<number> | number;
  calculateExpirationBlock(btl_days: number): number;
  getUserQuota?(userAddress: string): Promise<{ used_bytes: number; uploads_today: number }>;
  updateUserQuota?(userAddress: string, addedBytes: number): Promise<void>;
  getFilesByOwner?(owner: string): Promise<any[]>;
  getFileEntityKeys?(file_id: string): Promise<{ metadata_key?: string; chunk_keys: string[] }>;
  storeBatch?(metadata: any, chunks: any[]): Promise<{ metadata_key: string; chunk_keys: string[] }>;
  storeBatchChunks?(chunks: any[]): Promise<string[]>;
}

export class StorageFactory {
  static async createStorage(): Promise<IStorage> {
    if (CONFIG.STORAGE_MODE === 'arkiv') {
      throw new Error('Arkiv storage temporarily disabled due to arkiv-sdk-js export issues');
    } else {
      console.log('💾 Using in-memory storage...');
      return new MemoryStorage();
    }
  }
}
