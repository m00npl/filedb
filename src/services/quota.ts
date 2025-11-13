import { CONFIG, QuotaInfo } from '../types';
import { IStorage } from '../storage/storage-factory';
import { RedisSessionStore } from './redis-session-store';

export class QuotaService {
  private userUsage: Map<string, QuotaInfo> = new Map();
  private storage: IStorage | null = null;
  private redisCache: RedisSessionStore;
  private cacheInitialized = false;
  private lastResetDate: Map<string, string> = new Map();

  constructor(storage?: IStorage) {
    this.storage = storage || null;
    this.redisCache = new RedisSessionStore();
    this.initializeCache();
  }

  private async initializeCache(): Promise<void> {
    try {
      await this.redisCache.initialize();
      this.cacheInitialized = true;
      console.log('✅ Quota cache (Redis) initialized');
    } catch (error) {
      console.warn('⚠️ Quota cache unavailable, using in-memory fallback');
    }
  }

  getUserId(request: any): string {
    return request.headers?.['x-user-id'] || 'anonymous';
  }

  hasUnlimitedAccess(request: any): boolean {
    const apiKey = request.headers?.['x-api-key'];
    return !!(CONFIG.UNLIMITED_API_KEY && apiKey === CONFIG.UNLIMITED_API_KEY);
  }

  private shouldResetQuota(userId: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    const lastReset = this.lastResetDate.get(userId);
    
    if (!lastReset || lastReset !== today) {
      this.lastResetDate.set(userId, today);
      return lastReset !== undefined && lastReset !== today;
    }
    
    return false;
  }

  private resetQuota(userId: string): void {
    const quota = this.userUsage.get(userId);
    if (quota) {
      quota.uploads_today = 0;
      // Note: used_bytes accumulates, only uploads_today resets daily
      this.userUsage.set(userId, quota);
      console.log(`🔄 Reset daily quota for user ${userId}`);
    }
  }

  async checkQuota(userId: string, fileSize: number, request?: any): Promise<{ allowed: boolean; reason?: string }> {
    // Check unlimited access first
    if (request && this.hasUnlimitedAccess(request)) {
      return { allowed: true };
    }

    // Reset quota if date has changed
    if (this.shouldResetQuota(userId)) {
      this.resetQuota(userId);
      // Clear cache to force fresh read
      if (this.cacheInitialized) {
        try {
          await this.redisCache.deleteSessionData(`quota:${userId}`);
        } catch (error) {
          console.warn('Failed to clear quota cache during reset');
        }
      }
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
    // Always update in-memory first for immediate consistency
    const quota = this.userUsage.get(userId) || {
      used_bytes: 0,
      max_bytes: CONFIG.FREE_TIER_MAX_BYTES,
      uploads_today: 0,
      max_uploads_per_day: CONFIG.FREE_TIER_MAX_UPLOADS_PER_DAY
    };
    quota.used_bytes += fileSize;
    quota.uploads_today += 1;
    this.userUsage.set(userId, quota);

    // Update cache
    if (this.cacheInitialized) {
      try {
        await this.redisCache.storeSessionData(`quota:${userId}`, JSON.stringify(quota), 600);
        console.log(`💾 Updated quota cache for user ${userId}`);
      } catch (error) {
        console.warn('Failed to update quota cache:', error.message);
      }
    }

    // Update blockchain asynchronously (with timeout to prevent hanging)
    if (this.storage && this.storage.updateUserQuota) {
      const timeoutMs = 30000; // 30 second timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Blockchain quota update timed out')), timeoutMs);
      });

      Promise.race([
        this.storage.updateUserQuota(userId, fileSize),
        timeoutPromise
      ]).catch(error => {
        console.warn(`⚠️ Blockchain quota update failed for user ${userId}:`, error.message);
        // Non-critical: cache and in-memory are already updated
      });
    }
  }

  private async getUserQuota(userId: string): Promise<QuotaInfo> {
    // Try Redis cache first (10 minute TTL)
    if (this.cacheInitialized) {
      try {
        const cached = await this.redisCache.getSessionData(`quota:${userId}`);
        if (cached) {
          console.log(`📊 Quota cache hit for user ${userId}`);
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('Redis quota cache read failed:', error.message);
      }
    }

    if (this.storage && this.storage.getUserQuota) {
      // Use blockchain-based quota tracking
      try {
        const blockchainQuota = await this.storage.getUserQuota(userId);
        const quota = {
          used_bytes: blockchainQuota.used_bytes,
          max_bytes: CONFIG.FREE_TIER_MAX_BYTES,
          uploads_today: blockchainQuota.uploads_today,
          max_uploads_per_day: CONFIG.FREE_TIER_MAX_UPLOADS_PER_DAY
        };

        // Cache the result for 10 minutes
        if (this.cacheInitialized) {
          try {
            await this.redisCache.storeSessionData(`quota:${userId}`, JSON.stringify(quota), 600);
            console.log(`💾 Cached quota for user ${userId}`);
          } catch (error) {
            console.warn('Redis quota cache write failed:', error.message);
          }
        }

        return quota;
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