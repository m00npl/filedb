import { CONFIG, QuotaInfo } from '../types';

export class QuotaService {
  private userUsage: Map<string, QuotaInfo> = new Map();

  getUserId(request: any): string {
    return request.headers?.['x-user-id'] || 'anonymous';
  }

  async checkQuota(userId: string, fileSize: number): Promise<{ allowed: boolean; reason?: string }> {
    const quota = this.getUserQuota(userId);

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
    const quota = this.getUserQuota(userId);
    quota.used_bytes += fileSize;
    quota.uploads_today += 1;
    this.userUsage.set(userId, quota);
  }

  private getUserQuota(userId: string): QuotaInfo {
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