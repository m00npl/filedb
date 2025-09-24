import { CONFIG, QuotaInfo } from '../types';
import { IStorage } from '../storage/storage-factory';

export class QuotaService {
  private userUsage: Map<string, QuotaInfo> = new Map();
  private storage: IStorage | null = null;

  constructor(storage?: IStorage) {
    this.storage = storage || null;
  }

  getUserId(request: any): string {
    return request.headers?.['x-user-id'] || 'anonymous';
  }

  hasUnlimitedAccess(request: any): boolean {
    const apiKey = request.headers?.['x-api-key'];
    return CONFIG.UNLIMITED_API_KEY && apiKey === CONFIG.UNLIMITED_API_KEY;
  }

  async checkQuota(userId: string, fileSize: number, request?: any): Promise<{ allowed: boolean; reason?: string }> {
    // Check unlimited access first
    if (request && this.hasUnlimitedAccess(request)) {
      return { allowed: true };
    }

    const quota = await this.getUserQuota(userId);

    if (quota.used_bytes + fileSize > quota.max_bytes) {
      return {
        allowed: false,
        reason: `Quota exceeded. Used: ${quota.used_bytes}/${quota.max_bytes} bytes`
      };
    }

    if (quota.uploads_today >= quota.max_uploads_per_day) {
      return {
        allowed: false,
        reason: `Daily upload limit exceeded. Used: ${quota.uploads_today}/${quota.max_uploads_per_day} uploads`
      };
    }

    return { allowed: true };
  }

  async updateUsage(userId: string, fileSize: number): Promise<void> {
    if (this.storage && this.storage.updateUserQuota) {
      // Use blockchain-based quota tracking
      await this.storage.updateUserQuota(userId, fileSize);
    } else {
      // Fallback to in-memory tracking
      const quota = await this.getUserQuota(userId);
      quota.used_bytes += fileSize;
      quota.uploads_today += 1;
      this.userUsage.set(userId, quota);
    }
  }

  private async getUserQuota(userId: string): Promise<QuotaInfo> {
    if (this.storage && this.storage.getUserQuota) {
      // Use blockchain-based quota tracking
      try {
        const blockchainQuota = await this.storage.getUserQuota(userId);
        return {
          used_bytes: blockchainQuota.used_bytes,
          max_bytes: CONFIG.FREE_TIER_MAX_BYTES,
          uploads_today: blockchainQuota.uploads_today,
          max_uploads_per_day: CONFIG.FREE_TIER_MAX_UPLOADS_PER_DAY
        };
      } catch (error) {
        console.warn('Failed to get blockchain quota, falling back to memory:', error);
      }
    }

    // Fallback to in-memory tracking
    if (!this.userUsage.has(userId)) {
      this.userUsage.set(userId, {
        used_bytes: 0,
        max_bytes: CONFIG.FREE_TIER_MAX_BYTES,
        uploads_today: 0,
        max_uploads_per_day: CONFIG.FREE_TIER_MAX_UPLOADS_PER_DAY
      });
    }

    return this.userUsage.get(userId)!;
  }

  async getQuotaInfo(userId: string): Promise<QuotaInfo> {
    return this.getUserQuota(userId);
  }
}