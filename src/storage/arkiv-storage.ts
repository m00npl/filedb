import { createClient, createROClient } from 'arkiv-sdk';
import { ChunkEntity, FileMetadata } from '../types';

export class ArkivStorage {
  private writeClient: any = null;
  private roClient: any = null;
  private initialized: Promise<void>;

  constructor() {
    this.initialized = this.initializeClients();
  }

  private async initializeClients(): Promise<void> {
    try {
      const chainId = parseInt(process.env.ARKIV_CHAIN_ID || '60138453025');
      const rpcUrl = process.env.ARKIV_RPC_URL || 'https://kaolin.hoodi.arkiv.network/rpc';
      const wsUrl = process.env.ARKIV_WS_URL || 'wss://kaolin.hoodi.arkiv.network/rpc/ws';

      // Connection pooling configuration for better performance
      const connectionConfig = {
        timeout: parseInt(process.env.BLOCKCHAIN_TIMEOUT || '300000'), // 5 minutes
        keepAlive: true,
        maxConnections: 10,
        retryAttempts: 3
      };

      console.log(`🔗 Initializing Arkiv clients with optimized connections (timeout: ${connectionConfig.timeout}ms)`);

      // Always create read-only client with connection pooling
      this.roClient = createROClient(chainId, rpcUrl, wsUrl);

      // Create write client if private key available
      let privateKeyHex = process.env.ARKIV_PRIVATE_KEY;

      // Try to read from Docker secrets if env variable not available
      if (!privateKeyHex) {
        try {
          const fs = require('fs');
          const secretPath = '/run/secrets/arkiv_private_key';
          console.log(`🔍 Checking for Docker secret at: ${secretPath}`);
          if (fs.existsSync(secretPath)) {
            privateKeyHex = fs.readFileSync(secretPath, 'utf8').trim();
            console.log('🔐 Loaded private key from Docker secrets');
          } else {
            console.log('💡 Docker secret file does not exist');
          }
        } catch (error) {
          console.log('💡 Error reading Docker secrets:', error.message);
        }
      } else {
        console.log('🔑 Using private key from environment variable');
      }
      if (privateKeyHex) {
        const hexKey = privateKeyHex.replace('0x', '');
        const accountData = {
          tag: 'privatekey',
          data: Buffer.from(hexKey, 'hex')
        };

        // Create write client
        this.writeClient = await createClient(chainId, accountData, rpcUrl, wsUrl);

        console.log('✅ Connected to Arkiv with write access');
        const ownerAddress = await this.writeClient.getOwnerAddress();
        console.log(`📍 Owner address: ${ownerAddress}`);
      } else {
        console.log('✅ Connected to Arkiv with read-only access');
      }
    } catch (error) {
      console.error('❌ Failed to connect to Arkiv:', error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    await this.initialized;
  }

  async storeChunk(chunk: ChunkEntity): Promise<void> {
    await this.initialize();

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      const currentBlock = await this.getCurrentBlock();
      const btl = Math.max(chunk.expiration_block - Number(currentBlock), 1);

      const entity = {
        data: chunk.data,
        btl: btl,
        stringAnnotations: [
          { key: 'type', value: 'chunk' },
          { key: 'file_id', value: chunk.file_id },
          { key: 'chunk_index', value: chunk.chunk_index.toString() },
          { key: 'checksum', value: chunk.checksum },
          { key: 'created_at', value: chunk.created_at.toISOString() }
        ],
        numericAnnotations: [
          { key: 'chunk_size', value: chunk.data.length },
          { key: 'expiration_block', value: chunk.expiration_block }
        ]
      };

      const receipts = await this.retryBlockchainOperation(
        () => this.writeClient.createEntities([entity]),
        `store chunk ${chunk.chunk_index}`
      );
      chunk.entity_key = receipts[0].entityKey;

      console.log(`📦 Stored chunk ${chunk.chunk_index} for file ${chunk.file_id}`);
    } catch (error) {
      console.error('❌ Failed to store chunk:', error);
      throw new Error(`Failed to store chunk: ${error}`);
    }
  }

  async storeBatchChunks(chunks: ChunkEntity[]): Promise<string[]> {
    await this.initialize();

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      const currentBlock = await this.getCurrentBlock();
      const entities: any[] = [];

      // Add chunk entities only
      for (const chunk of chunks) {
        const chunkBtl = Math.max(chunk.expiration_block - Number(currentBlock), 1);

        entities.push({
          data: chunk.data,
          btl: chunkBtl,
          stringAnnotations: [
            { key: 'type', value: 'chunk' },
            { key: 'file_id', value: chunk.file_id },
            { key: 'chunk_index', value: chunk.chunk_index.toString() },
            { key: 'checksum', value: chunk.checksum },
            { key: 'created_at', value: chunk.created_at.toISOString() }
          ],
          numericAnnotations: [
            { key: 'chunk_size', value: chunk.data.length },
            { key: 'expiration_block', value: chunk.expiration_block }
          ]
        });
      }

      console.log(`🚀 Batch storing ${entities.length} chunk entities for file ${chunks[0]?.file_id}`);

      const receipts = await this.retryBlockchainOperation(
        () => this.writeClient.createEntities(entities),
        `batch store ${chunks.length} chunks`,
        5, // More retries for batch operations
        2000 // Longer initial delay
      );

      // Extract entity keys
      const chunk_keys = receipts.map(receipt => receipt.entityKey);

      // Update entity keys in objects
      chunks.forEach((chunk, index) => {
        chunk.entity_key = chunk_keys[index];
      });

      console.log(`✅ Batch stored ${chunks.length} chunks in single transaction`);

      return chunk_keys;
    } catch (error) {
      console.error('❌ Failed to batch store chunks:', error);
      throw new Error(`Failed to batch store chunks: ${error}`);
    }
  }

  async storeBatch(metadata: FileMetadata, chunks: ChunkEntity[]): Promise<{ metadata_key: string; chunk_keys: string[] }> {
    await this.initialize();

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      const currentBlock = await this.getCurrentBlock();
      const entities: any[] = [];

      // Add metadata entity
      const metadataBtl = Math.max(metadata.expiration_block - Number(currentBlock), 1);
      const metadataJson = JSON.stringify({
        file_id: metadata.file_id,
        original_filename: metadata.original_filename,
        content_type: metadata.content_type,
        file_extension: metadata.file_extension,
        total_size: metadata.total_size,
        chunk_count: metadata.chunk_count,
        checksum: metadata.checksum,
        created_at: metadata.created_at.toISOString(),
        btl_days: metadata.btl_days
      });

      entities.push({
        data: Buffer.from(metadataJson, 'utf-8'),
        btl: metadataBtl,
        stringAnnotations: [
          { key: 'type', value: 'metadata' },
          { key: 'file_id', value: metadata.file_id },
          { key: 'original_filename', value: metadata.original_filename },
          { key: 'content_type', value: metadata.content_type },
          { key: 'file_extension', value: metadata.file_extension },
          { key: 'checksum', value: metadata.checksum },
          ...(metadata.owner ? [{ key: 'owner', value: metadata.owner }] : [])
        ],
        numericAnnotations: [
          { key: 'total_size', value: metadata.total_size },
          { key: 'chunk_count', value: metadata.chunk_count },
          { key: 'expiration_block', value: metadata.expiration_block },
          { key: 'btl_days', value: metadata.btl_days }
        ]
      });

      // Add chunk entities
      for (const chunk of chunks) {
        const chunkBtl = Math.max(chunk.expiration_block - Number(currentBlock), 1);

        entities.push({
          data: chunk.data,
          btl: chunkBtl,
          stringAnnotations: [
            { key: 'type', value: 'chunk' },
            { key: 'file_id', value: chunk.file_id },
            { key: 'chunk_index', value: chunk.chunk_index.toString() },
            { key: 'checksum', value: chunk.checksum },
            { key: 'created_at', value: chunk.created_at.toISOString() }
          ],
          numericAnnotations: [
            { key: 'chunk_size', value: chunk.data.length },
            { key: 'expiration_block', value: chunk.expiration_block }
          ]
        });
      }

      console.log(`🚀 Batch storing ${entities.length} entities (1 metadata + ${chunks.length} chunks) for file ${metadata.file_id}`);

      const receipts = await this.retryBlockchainOperation(
        () => this.writeClient.createEntities(entities),
        `batch store file ${metadata.file_id}`,
        5, // More retries for batch operations
        2000 // Longer initial delay
      );

      // Extract entity keys
      const metadata_key = receipts[0].entityKey;
      const chunk_keys = receipts.slice(1).map(receipt => receipt.entityKey);

      // Update entity keys in objects
      metadata.entity_key = metadata_key;
      chunks.forEach((chunk, index) => {
        chunk.entity_key = chunk_keys[index];
      });

      console.log(`✅ Batch stored file ${metadata.file_id} with ${chunks.length} chunks in single transaction`);

      return { metadata_key, chunk_keys };
    } catch (error) {
      console.error('❌ Failed to batch store:', error);
      throw new Error(`Failed to batch store: ${error}`);
    }
  }

  async getChunk(file_id: string, chunk_index: number): Promise<ChunkEntity | null> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        console.error('❌ Cannot get chunks without owner address');
        return null;
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const isChunk = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'chunk'
        );
        const matchesFileId = metadata.stringAnnotations.some(
          ann => ann.key === 'file_id' && ann.value === file_id
        );
        const matchesChunkIndex = metadata.stringAnnotations.some(
          ann => ann.key === 'chunk_index' && ann.value === chunk_index.toString()
        );

        if (isChunk && matchesFileId && matchesChunkIndex) {
          const data = await this.roClient.getStorageValue(entityKey);

          return {
            id: entityKey,
            file_id,
            chunk_index,
            data: Buffer.from(data),
            checksum: this.getAnnotationValue(metadata.stringAnnotations, 'checksum'),
            created_at: new Date(this.getAnnotationValue(metadata.stringAnnotations, 'created_at')),
            expiration_block: this.getAnnotationValue(metadata.numericAnnotations, 'expiration_block'),
            entity_key: entityKey
          };
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to get chunk:', error);
      return null;
    }
  }

  async storeMetadata(metadata: FileMetadata): Promise<void> {
    await this.initialize();

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      const currentBlock = await this.getCurrentBlock();
      const btl = Math.max(metadata.expiration_block - Number(currentBlock), 1);

      const metadataJson = JSON.stringify({
        file_id: metadata.file_id,
        original_filename: metadata.original_filename,
        content_type: metadata.content_type,
        file_extension: metadata.file_extension,
        total_size: metadata.total_size,
        chunk_count: metadata.chunk_count,
        checksum: metadata.checksum,
        created_at: metadata.created_at.toISOString(),
        btl_days: metadata.btl_days
      });

      const entity = {
        data: Buffer.from(metadataJson, 'utf-8'),
        btl: btl,
        stringAnnotations: [
          { key: 'type', value: 'metadata' },
          { key: 'file_id', value: metadata.file_id },
          { key: 'original_filename', value: metadata.original_filename },
          { key: 'content_type', value: metadata.content_type },
          { key: 'file_extension', value: metadata.file_extension },
          { key: 'checksum', value: metadata.checksum },
          ...(metadata.owner ? [{ key: 'owner', value: metadata.owner }] : [])
        ],
        numericAnnotations: [
          { key: 'total_size', value: metadata.total_size },
          { key: 'chunk_count', value: metadata.chunk_count },
          { key: 'expiration_block', value: metadata.expiration_block },
          { key: 'btl_days', value: metadata.btl_days }
        ]
      };

      const receipts = await this.retryBlockchainOperation(
        () => this.writeClient.createEntities([entity]),
        `store metadata for file ${metadata.file_id}`
      );
      metadata.entity_key = receipts[0].entityKey;

      console.log(`📋 Stored metadata for file ${metadata.file_id}`);
    } catch (error) {
      console.error('❌ Failed to store metadata:', error);
      throw new Error(`Failed to store metadata: ${error}`);
    }
  }

  async getMetadata(file_id: string): Promise<FileMetadata | null> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        console.error('❌ Cannot get metadata without owner address');
        return null;
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const isMetadata = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'metadata'
        );
        const matchesFileId = metadata.stringAnnotations.some(
          ann => ann.key === 'file_id' && ann.value === file_id
        );

        if (isMetadata && matchesFileId) {
          const data = await this.roClient.getStorageValue(entityKey);
          const metadataJson = JSON.parse(data.toString('utf-8'));

          return {
            ...metadataJson,
            created_at: new Date(metadataJson.created_at),
            entity_key: entityKey
          };
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to get metadata:', error);
      return null;
    }
  }

  async getAllChunks(file_id: string): Promise<ChunkEntity[]> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        console.error('❌ Cannot get chunks without owner address');
        return [];
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);
      const chunks: ChunkEntity[] = [];

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const isChunk = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'chunk'
        );
        const matchesFileId = metadata.stringAnnotations.some(
          ann => ann.key === 'file_id' && ann.value === file_id
        );

        if (isChunk && matchesFileId) {
          const data = await this.roClient.getStorageValue(entityKey);

          chunks.push({
            id: entityKey,
            file_id,
            chunk_index: parseInt(this.getAnnotationValue(metadata.stringAnnotations, 'chunk_index')),
            data: Buffer.from(data),
            checksum: this.getAnnotationValue(metadata.stringAnnotations, 'checksum'),
            created_at: new Date(this.getAnnotationValue(metadata.stringAnnotations, 'created_at')),
            expiration_block: this.getAnnotationValue(metadata.numericAnnotations, 'expiration_block'),
            entity_key: entityKey
          });
        }
      }

      // Sort by chunk index
      chunks.sort((a, b) => a.chunk_index - b.chunk_index);

      return chunks;
    } catch (error) {
      console.error('❌ Failed to get all chunks:', error);
      return [];
    }
  }

  async getCurrentBlock(): Promise<number> {
    await this.initialize();

    try {
      if (this.writeClient?.getRawClient) {
        const rawClient = this.writeClient.getRawClient();
        const blockNumber = await rawClient.httpClient.getBlockNumber();
        return Number(blockNumber);
      }
      // Fallback calculation
      return Math.floor(Date.now() / 1000 / 2);
    } catch (error) {
      console.error('❌ Failed to get current block:', error);
      return Math.floor(Date.now() / 1000 / 2);
    }
  }

  calculateExpirationBlock(btl_days: number): number {
    const currentBlock = Math.floor(Date.now() / 1000 / 2);
    const blocksPerDay = (24 * 60 * 60) / 2; // 43200 blocks per day
    return currentBlock + Math.floor(btl_days * blocksPerDay);
  }

  private getAnnotationValue(annotations: any[], key: string): any {
    const annotation = annotations.find(a => a.key === key);
    return annotation ? annotation.value : null;
  }

  // Blockchain-based quota tracking
  async getUserQuota(userAddress: string): Promise<{ used_bytes: number; uploads_today: number }> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        return { used_bytes: 0, uploads_today: 0 };
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);
      const today = new Date().toISOString().split('T')[0];

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const isQuota = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'quota'
        );
        const matchesUser = metadata.stringAnnotations.some(
          ann => ann.key === 'user_address' && ann.value === userAddress
        );
        const matchesToday = metadata.stringAnnotations.some(
          ann => ann.key === 'date' && ann.value === today
        );

        if (isQuota && matchesUser && matchesToday) {
          const data = await this.roClient.getStorageValue(entityKey);
          const quotaData = JSON.parse(data.toString('utf-8'));

          return {
            used_bytes: quotaData.used_bytes || 0,
            uploads_today: quotaData.uploads_today || 0
          };
        }
      }

      return { used_bytes: 0, uploads_today: 0 };
    } catch (error) {
      console.error('❌ Failed to get user quota:', error);
      return { used_bytes: 0, uploads_today: 0 };
    }
  }

  async updateUserQuota(userAddress: string, addedBytes: number): Promise<void> {
    await this.initialize();

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      const currentQuota = await this.getUserQuota(userAddress);
      const today = new Date().toISOString().split('T')[0];

      const quotaData = {
        user_address: userAddress,
        used_bytes: currentQuota.used_bytes + addedBytes,
        uploads_today: currentQuota.uploads_today + 1,
        last_updated: new Date().toISOString(),
        date: today
      };

      const entity = {
        data: Buffer.from(JSON.stringify(quotaData), 'utf-8'),
        btl: 5760, // 1 day
        stringAnnotations: [
          { key: 'type', value: 'quota' },
          { key: 'user_address', value: userAddress },
          { key: 'date', value: today }
        ],
        numericAnnotations: [
          { key: 'used_bytes', value: quotaData.used_bytes },
          { key: 'uploads_today', value: quotaData.uploads_today }
        ]
      };

      await this.writeClient.createEntities([entity]);
      console.log(`📊 Updated quota for user ${userAddress}`);
    } catch (error) {
      console.error('❌ Failed to update user quota:', error);
      throw new Error(`Failed to update user quota: ${error}`);
    }
  }

  async getFilesByOwner(owner: string): Promise<FileMetadata[]> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        console.error('❌ Cannot get files without owner address');
        return [];
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);
      const files: FileMetadata[] = [];

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const isMetadata = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'metadata'
        );
        const hasOwner = metadata.stringAnnotations.some(
          ann => ann.key === 'owner' && ann.value === owner
        );

        if (isMetadata && hasOwner) {
          const data = await this.roClient.getStorageValue(entityKey);
          const metadataJson = JSON.parse(data.toString('utf-8'));

          files.push({
            ...metadataJson,
            created_at: new Date(metadataJson.created_at),
            entity_key: entityKey,
            owner: this.getAnnotationValue(metadata.stringAnnotations, 'owner')
          });
        }
      }

      // Sort by creation date (newest first)
      files.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

      return files;
    } catch (error) {
      console.error('❌ Failed to get files by owner:', error);
      return [];
    }
  }

  async getFileEntityKeys(file_id: string): Promise<{ metadata_key?: string; chunk_keys: string[] }> {
    await this.initialize();

    try {
      const ownerAddress = this.writeClient
        ? await this.writeClient.getOwnerAddress()
        : null;

      if (!ownerAddress) {
        console.error('❌ Cannot get entity keys without owner address');
        return { chunk_keys: [] };
      }

      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);
      let metadata_key: string | undefined = undefined;
      const chunksWithIndex: { key: string; index: number }[] = [];

      for (const entityKey of allEntities) {
        const metadata = await this.roClient.getEntityMetaData(entityKey);

        const matchesFileId = metadata.stringAnnotations.some(
          ann => ann.key === 'file_id' && ann.value === file_id
        );

        if (!matchesFileId) continue;

        const isMetadata = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'metadata'
        );
        const isChunk = metadata.stringAnnotations.some(
          ann => ann.key === 'type' && ann.value === 'chunk'
        );

        if (isMetadata) {
          metadata_key = entityKey;
        } else if (isChunk) {
          const chunkIndexAnnotation = metadata.stringAnnotations.find(
            ann => ann.key === 'chunk_index'
          );
          const chunkIndex = chunkIndexAnnotation ? parseInt(chunkIndexAnnotation.value) : -1;
          chunksWithIndex.push({ key: entityKey, index: chunkIndex });
        }
      }

      // Sort chunks by index and extract keys
      const chunk_keys = chunksWithIndex
        .sort((a, b) => a.index - b.index)
        .map(chunk => chunk.key);

      return { metadata_key, chunk_keys };
    } catch (error) {
      console.error('❌ Failed to get file entity keys:', error);
      return { chunk_keys: [] };
    }
  }

  private async retryBlockchainOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} to ${operationName}`);
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          console.error(`❌ Failed ${operationName} after ${maxRetries} attempts:`, error);
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(`⚠️  Attempt ${attempt} failed for ${operationName}, retrying in ${delay}ms:`, error instanceof Error ? error.message : error);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}
