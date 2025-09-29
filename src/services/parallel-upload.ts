import { ChunkEntity } from '../types';

export interface UploadWorkerPool {
  processChunks(chunks: ChunkEntity[], concurrency: number): Promise<void>;
  shutdown(): void;
}

export class ParallelUploadService implements UploadWorkerPool {
  private activeUploads = new Set<Promise<void>>();
  private isShutdown = false;

  constructor(
    private storage: any,
    private maxConcurrency: number = 5 // Optimized for blockchain constraints
  ) {}

  async processChunks(chunks: ChunkEntity[], concurrency: number = this.maxConcurrency): Promise<void> {
    if (this.isShutdown) {
      throw new Error('Upload service is shutdown');
    }

    const chunkBatches = this.createOptimalBatches(chunks);
    console.log(`🚀 Processing ${chunks.length} chunks in ${chunkBatches.length} parallel batches`);

    // Process batches with controlled concurrency
    const results = await this.processBatchesConcurrently(chunkBatches, concurrency);

    // Check for any failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`❌ ${failures.length} batch uploads failed`);
      // Don't throw - let individual chunk fallback handle failures
    }

    console.log(`✅ Parallel upload completed: ${results.length - failures.length}/${results.length} batches successful`);
  }

  private createOptimalBatches(chunks: ChunkEntity[]): ChunkEntity[][] {
    const OPTIMAL_BATCH_SIZE = 16; // 16 chunks per batch for optimal blockchain performance
    const batches: ChunkEntity[][] = [];

    for (let i = 0; i < chunks.length; i += OPTIMAL_BATCH_SIZE) {
      const batch = chunks.slice(i, i + OPTIMAL_BATCH_SIZE);
      batches.push(batch);
    }

    return batches;
  }

  private async processBatchesConcurrently(
    batches: ChunkEntity[][],
    concurrency: number
  ): Promise<PromiseSettledResult<void>[]> {
    const semaphore = new Semaphore(concurrency);

    const uploadPromises = batches.map(async (batch, batchIndex) => {
      await semaphore.acquire();

      try {
        await this.uploadBatchWithRetry(batch, batchIndex);
      } finally {
        semaphore.release();
      }
    });

    this.activeUploads = new Set(uploadPromises);

    try {
      return await Promise.allSettled(uploadPromises);
    } finally {
      this.activeUploads.clear();
    }
  }

  private async uploadBatchWithRetry(
    batch: ChunkEntity[],
    batchIndex: number,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📦 Batch ${batchIndex + 1}: uploading ${batch.length} chunks (attempt ${attempt}/${maxRetries})`);

        if (this.storage.storeBatchChunks) {
          // Use batch upload if available
          await this.storage.storeBatchChunks(batch);
          console.log(`✅ Batch ${batchIndex + 1}: successful`);
          return;
        } else {
          // Fallback to individual chunk uploads
          await this.uploadChunksIndividually(batch, batchIndex);
          return;
        }
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          console.error(`❌ Batch ${batchIndex + 1}: failed after ${maxRetries} attempts:`, error);
          throw error;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10s delay
        console.warn(`⚠️ Batch ${batchIndex + 1}: attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Upload failed with unknown error');
  }

  private async uploadChunksIndividually(batch: ChunkEntity[], batchIndex: number): Promise<void> {
    console.log(`🔄 Batch ${batchIndex + 1}: falling back to individual chunk uploads`);

    const chunkPromises = batch.map(async (chunk, chunkIndex) => {
      try {
        await this.storage.storeChunk(chunk);
        console.log(`📦 Batch ${batchIndex + 1}, chunk ${chunkIndex + 1}: uploaded`);
      } catch (error) {
        console.error(`❌ Batch ${batchIndex + 1}, chunk ${chunkIndex + 1}: failed:`, error);
        throw error;
      }
    });

    await Promise.all(chunkPromises);
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    if (this.activeUploads.size > 0) {
      console.log(`🛑 Shutting down parallel upload service (${this.activeUploads.size} active uploads)`);
      await Promise.allSettled(this.activeUploads);
    }
  }
}

// Simple semaphore implementation for concurrency control
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;

    const next = this.waitQueue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

// Progress tracking for uploads
export class UploadProgressTracker {
  private startTime: Date;
  private completedChunks = 0;
  private totalChunks: number;

  constructor(totalChunks: number) {
    this.totalChunks = totalChunks;
    this.startTime = new Date();
  }

  markChunkComplete(): void {
    this.completedChunks++;
  }

  getProgress(): {
    completed: number;
    total: number;
    percentage: number;
    elapsedMs: number;
    estimatedRemainingMs: number;
  } {
    const elapsedMs = Date.now() - this.startTime.getTime();
    const percentage = (this.completedChunks / this.totalChunks) * 100;

    let estimatedRemainingMs = 0;
    if (this.completedChunks > 0) {
      const avgTimePerChunk = elapsedMs / this.completedChunks;
      const remainingChunks = this.totalChunks - this.completedChunks;
      estimatedRemainingMs = avgTimePerChunk * remainingChunks;
    }

    return {
      completed: this.completedChunks,
      total: this.totalChunks,
      percentage: Math.round(percentage * 100) / 100,
      elapsedMs,
      estimatedRemainingMs: Math.round(estimatedRemainingMs)
    };
  }
}