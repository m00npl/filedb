import { GolemDBStorage as MemoryStorage } from './db-chain';
import { GolemDBStorage } from './golem-storage';
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
}

export class StorageFactory {
  static async createStorage(): Promise<IStorage> {
    if (CONFIG.STORAGE_MODE === 'golemdb') {
      console.log('🔗 Initializing Golem DB storage...');
      const storage = new GolemDBStorage();
      await storage.initialize();
      return storage;
    } else {
      console.log('💾 Using in-memory storage...');
      return new MemoryStorage();
    }
  }
}