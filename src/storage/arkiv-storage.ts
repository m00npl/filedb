import type { PublicArkivClient, WalletArkivClient } from '@arkiv-network/sdk';
import { createPublicClient, createWalletClient, defineChain, http } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { eq } from '@arkiv-network/sdk/query';
import { kaolin, localhost, marketplace, mendoza } from '@arkiv-network/sdk/chains';
import type { Chain, Hex } from 'viem';
import type { Attribute, MimeType } from '@arkiv-network/sdk';
import { ChunkEntity, FileMetadata } from '../types';
import { IStorage } from './storage-factory';

const DEFAULT_CHAIN_ID = 60138453025;
const DEFAULT_RPC_URL = 'https://kaolin.hoodi.arkiv.network/rpc';
const DEFAULT_WS_URL = 'wss://kaolin.hoodi.arkiv.network/rpc/ws';
const DEFAULT_BLOCK_TIME_SECONDS = 2;
const DEFAULT_CONTENT_TYPE: MimeType = 'application/octet-stream';
const METADATA_CONTENT_TYPE: MimeType = 'application/json';

type ArkivEntityCreatePayload = {
  payload: Uint8Array;
  attributes: Attribute[];
  contentType: MimeType;
  expiresIn: number;
};

export class ArkivStorage implements IStorage {
  private walletClient: WalletArkivClient | null = null;
  private publicClient: PublicArkivClient | null = null;
  private initialized: Promise<void>;
  private chainOwnerAddress?: Hex;
  private readonly configuredOwnerAddress?: Hex;
  private blockDurationSeconds = DEFAULT_BLOCK_TIME_SECONDS;

  constructor() {
    this.configuredOwnerAddress = this.normalizeHex(process.env.ARKIV_OWNER_ADDRESS);
    this.initialized = this.initializeClients();
  }

  private async initializeClients(): Promise<void> {
    try {
      const chainId = Number.parseInt(process.env.ARKIV_CHAIN_ID || String(DEFAULT_CHAIN_ID), 10);
      const rpcUrl = process.env.ARKIV_RPC_URL || DEFAULT_RPC_URL;
      const wsUrl = process.env.ARKIV_WS_URL || DEFAULT_WS_URL;
      const chain = this.resolveChain(chainId, rpcUrl, wsUrl);

      this.publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl)
      });

      await this.updateBlockTiming();

      let privateKeyHex = process.env.ARKIV_PRIVATE_KEY;
      if (!privateKeyHex) {
        try {
          const fs = await import('fs');
          const secretPath = '/run/secrets/arkiv_private_key';
          console.log(`🔍 Checking for Docker secret at: ${secretPath}`);
          if (fs.existsSync(secretPath)) {
            privateKeyHex = fs.readFileSync(secretPath, 'utf8').trim();
            console.log('🔐 Loaded private key from Docker secrets');
          } else {
            console.log('💡 Docker secret file does not exist');
          }
        } catch (error) {
          console.log('💡 Error reading Docker secrets:', (error as Error).message);
        }
      } else {
        console.log('🔑 Using private key from environment variable');
      }

      if (privateKeyHex) {
        const account = privateKeyToAccount(this.ensureHexPrefix(privateKeyHex) as Hex);
        this.walletClient = createWalletClient({
          chain,
          transport: http(rpcUrl),
          account
        });
        this.chainOwnerAddress = account.address;
        console.log('✅ Connected to Arkiv with write access');
        console.log(`📍 Owner address: ${account.address}`);
      } else {
        this.chainOwnerAddress = this.configuredOwnerAddress;
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

    const walletClient = this.requireWalletClient();

    try {
      const expiresIn = await this.computeExpiresInSeconds(chunk.expiration_block);
      const result = await this.retryBlockchainOperation(
        () => walletClient.createEntity(this.buildChunkPayload(chunk, expiresIn)),
        `store chunk ${chunk.chunk_index}`
      );
      chunk.entity_key = result.entityKey;
      console.log(`📦 Stored chunk ${chunk.chunk_index} for file ${chunk.file_id}`);
    } catch (error) {
      console.error('❌ Failed to store chunk:', error);
      throw new Error(`Failed to store chunk: ${error}`);
    }
  }

  async storeBatchChunks(chunks: ChunkEntity[]): Promise<string[]> {
    await this.initialize();

    const walletClient = this.requireWalletClient();

    try {
      const currentBlock = await this.getCurrentBlock();
      const creates = chunks.map(chunk => this.buildChunkPayload(chunk, this.blocksToSeconds(Math.max(chunk.expiration_block - currentBlock, 1))));

      console.log(`🚀 Batch storing ${creates.length} chunk entities for file ${chunks[0]?.file_id}`);

      const result = await this.retryBlockchainOperation(
        () => walletClient.mutateEntities({ creates }),
        `batch store ${chunks.length} chunks`,
        5,
        2000
      );

      if (!result.createdEntities || result.createdEntities.length !== chunks.length) {
        throw new Error('Batch chunk storage returned unexpected number of entity keys');
      }

      result.createdEntities.forEach((entityKey, index) => {
        chunks[index].entity_key = entityKey;
      });

      console.log(`✅ Batch stored ${chunks.length} chunks in single transaction`);

      return result.createdEntities;
    } catch (error) {
      console.error('❌ Failed to batch store chunks:', error);
      throw new Error(`Failed to batch store chunks: ${error}`);
    }
  }

  async storeBatch(metadata: FileMetadata, chunks: ChunkEntity[]): Promise<{ metadata_key: string; chunk_keys: string[] }> {
    await this.initialize();

    const walletClient = this.requireWalletClient();

    try {
      const currentBlock = await this.getCurrentBlock();
      const metadataPayload = this.buildMetadataPayload(metadata, this.blocksToSeconds(Math.max(metadata.expiration_block - currentBlock, 1)));
      const chunkPayloads = chunks.map(chunk => this.buildChunkPayload(chunk, this.blocksToSeconds(Math.max(chunk.expiration_block - currentBlock, 1))));
      const creates = [metadataPayload, ...chunkPayloads];

      console.log(`🚀 Batch storing ${creates.length} entities (1 metadata + ${chunks.length} chunks) for file ${metadata.file_id}`);

      const result = await this.retryBlockchainOperation(
        () => walletClient.mutateEntities({ creates }),
        `batch store file ${metadata.file_id}`,
        5,
        2000
      );

      if (!result.createdEntities || result.createdEntities.length !== creates.length) {
        throw new Error('Batch file storage returned unexpected number of entity keys');
      }

      metadata.entity_key = result.createdEntities[0];
      const chunkKeys = result.createdEntities.slice(1);
      chunkKeys.forEach((key, index) => {
        chunks[index].entity_key = key;
      });

      console.log(`✅ Batch stored file ${metadata.file_id} with ${chunks.length} chunks in single transaction`);

      return { metadata_key: result.createdEntities[0], chunk_keys: chunkKeys };
    } catch (error) {
      console.error('❌ Failed to batch store:', error);
      throw new Error(`Failed to batch store: ${error}`);
    }
  }

  async getChunk(file_id: string, chunk_index: number): Promise<ChunkEntity | null> {
    await this.initialize();

    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      console.error('❌ Cannot get chunks without owner address');
      return null;
    }

    try {
      const publicClient = this.requirePublicClient();
      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .withPayload(true)
        .where([
          eq('type', 'chunk'),
          eq('file_id', file_id),
          eq('chunk_index', chunk_index)
        ])
        .limit(1);

      const result = await query.fetch();
      if (!result.entities.length) {
        return null;
      }

      const entity = result.entities[0];
      const attributeMap = this.attributesToMap(entity.attributes);
      const payload = entity.payload ? Buffer.from(entity.payload) : Buffer.alloc(0);

      return {
        id: entity.key,
        file_id,
        chunk_index,
        data: payload,
        checksum: String(attributeMap.get('checksum') ?? ''),
        created_at: new Date(String(attributeMap.get('created_at') ?? new Date().toISOString())),
        expiration_block: Number(attributeMap.get('expiration_block') ?? 0),
        entity_key: entity.key
      };
    } catch (error) {
      console.error('❌ Failed to get chunk:', error);
      return null;
    }
  }

  async storeMetadata(metadata: FileMetadata): Promise<void> {
    await this.initialize();

    const walletClient = this.requireWalletClient();

    try {
      const expiresIn = await this.computeExpiresInSeconds(metadata.expiration_block);
      const result = await this.retryBlockchainOperation(
        () => walletClient.createEntity(this.buildMetadataPayload(metadata, expiresIn)),
        `store metadata for file ${metadata.file_id}`
      );
      metadata.entity_key = result.entityKey;
      console.log(`📋 Stored metadata for file ${metadata.file_id}`);
    } catch (error) {
      console.error('❌ Failed to store metadata:', error);
      throw new Error(`Failed to store metadata: ${error}`);
    }
  }

  async getMetadata(file_id: string, metadataEntityKey?: string): Promise<FileMetadata | null> {
    await this.initialize();

    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      console.error('❌ Cannot get metadata without owner address');
      return null;
    }

    const publicClient = this.requirePublicClient();

    try {
      if (metadataEntityKey) {
        try {
          const entity = await publicClient.getEntity(metadataEntityKey as Hex);
          const metadataJson = this.parseMetadataPayload(entity);
          return {
            ...metadataJson,
            created_at: new Date(metadataJson.created_at),
            entity_key: metadataEntityKey
          };
        } catch (error) {
          console.warn(`⚠️ Failed to get metadata with entity key ${metadataEntityKey}, falling back to full scan`);
        }
      }

      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .withPayload(true)
        .where([
          eq('type', 'metadata'),
          eq('file_id', file_id)
        ])
        .limit(1);

      const result = await query.fetch();
      if (!result.entities.length) {
        return null;
      }

      const entity = result.entities[0];
      const metadataJson = this.parseMetadataPayload(entity);

      return {
        ...metadataJson,
        created_at: new Date(metadataJson.created_at),
        entity_key: entity.key
      };
    } catch (error) {
      console.error('❌ Failed to get metadata:', error);
      return null;
    }
  }

  async getAllChunks(file_id: string, chunkEntityKeys?: string[]): Promise<ChunkEntity[]> {
    await this.initialize();

    const publicClient = this.requirePublicClient();
    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      console.error('❌ Cannot get chunks without owner address');
      return [];
    }

    try {
      if (chunkEntityKeys && chunkEntityKeys.length > 0) {
        const entities = await Promise.all(
          chunkEntityKeys.map(async (entityKey, index) => {
            const entity = await publicClient.getEntity(entityKey as Hex);
            return { entity, index };
          })
        );

        return entities.map(({ entity, index }) => {
          const attributeMap = this.attributesToMap(entity.attributes);
          const payload = entity.payload ? Buffer.from(entity.payload) : Buffer.alloc(0);
          const chunkIndex = Number(attributeMap.get('chunk_index') ?? index);

          return {
            id: entity.key,
            file_id,
            chunk_index: chunkIndex,
            data: payload,
            checksum: String(attributeMap.get('checksum') ?? ''),
            created_at: new Date(String(attributeMap.get('created_at') ?? new Date().toISOString())),
            expiration_block: Number(attributeMap.get('expiration_block') ?? 0),
            entity_key: entity.key
          };
        }).sort((a, b) => a.chunk_index - b.chunk_index);
      }

      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .withPayload(true)
        .orderBy('chunk_index', 'number', 'asc')
        .where([
          eq('type', 'chunk'),
          eq('file_id', file_id)
        ]);

      let result = await query.fetch();
      const entities = [...result.entities];
      while (result.hasNextPage()) {
        await result.next();
        entities.push(...result.entities);
      }

      return entities
        .map(entity => {
          const attributeMap = this.attributesToMap(entity.attributes);
          const payload = entity.payload ? Buffer.from(entity.payload) : Buffer.alloc(0);
          const chunkIndex = Number(attributeMap.get('chunk_index') ?? 0);

          return {
            id: entity.key,
            file_id,
            chunk_index: chunkIndex,
            data: payload,
            checksum: String(attributeMap.get('checksum') ?? ''),
            created_at: new Date(String(attributeMap.get('created_at') ?? new Date().toISOString())),
            expiration_block: Number(attributeMap.get('expiration_block') ?? 0),
            entity_key: entity.key
          };
        })
        .sort((a, b) => a.chunk_index - b.chunk_index);
    } catch (error) {
      console.error('❌ Failed to get all chunks:', error);
      return [];
    }
  }

  async getCurrentBlock(): Promise<number> {
    await this.initialize();

    try {
      if (this.publicClient) {
        const blockNumber = await this.publicClient.getBlockNumber();
        return Number(blockNumber);
      }

      return this.estimateCurrentBlock();
    } catch (error) {
      console.error('❌ Failed to get current block:', error);
      return this.estimateCurrentBlock();
    }
  }

  getAllMetadata(): never {
    throw new Error('Cannot get all metadata from blockchain storage - use getFilesByOwner instead');
  }

  calculateExpirationBlock(btl_days: number): number {
    const currentBlock = this.estimateCurrentBlock();
    const blocksPerDay = Math.floor((24 * 60 * 60) / this.blockDurationSeconds);
    return currentBlock + Math.floor(btl_days * blocksPerDay);
  }

  async getUserQuota(userAddress: string): Promise<{ used_bytes: number; uploads_today: number }> {
    await this.initialize();

    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      return { used_bytes: 0, uploads_today: 0 };
    }

    try {
      const publicClient = this.requirePublicClient();
      const today = new Date().toISOString().split('T')[0];

      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .withPayload(true)
        .where([
          eq('type', 'quota'),
          eq('user_address', userAddress),
          eq('date', today)
        ])
        .limit(1);

      const result = await query.fetch();
      if (!result.entities.length) {
        return { used_bytes: 0, uploads_today: 0 };
      }

      const payload = result.entities[0].payload ? Buffer.from(result.entities[0].payload) : Buffer.from('{}');
      const quotaData = JSON.parse(payload.toString('utf-8'));

      return {
        used_bytes: quotaData.used_bytes || 0,
        uploads_today: quotaData.uploads_today || 0
      };
    } catch (error) {
      console.error('❌ Failed to get user quota:', error);
      return { used_bytes: 0, uploads_today: 0 };
    }
  }

  async updateUserQuota(userAddress: string, addedBytes: number): Promise<void> {
    await this.initialize();

    const walletClient = this.requireWalletClient();

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

      const payload: ArkivEntityCreatePayload = {
        payload: Buffer.from(JSON.stringify(quotaData), 'utf-8'),
        contentType: METADATA_CONTENT_TYPE,
        expiresIn: this.blocksToSeconds(5760),
        attributes: [
          { key: 'type', value: 'quota' },
          { key: 'user_address', value: userAddress },
          { key: 'date', value: today },
          { key: 'used_bytes', value: quotaData.used_bytes },
          { key: 'uploads_today', value: quotaData.uploads_today }
        ]
      };

      await walletClient.createEntity(payload);
      console.log(`📊 Updated quota for user ${userAddress}`);
    } catch (error) {
      console.error('❌ Failed to update user quota:', error);
      throw new Error(`Failed to update user quota: ${error}`);
    }
  }

  async getFilesByOwner(owner: string): Promise<FileMetadata[]> {
    await this.initialize();

    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      console.error('❌ Cannot get files without owner address');
      return [];
    }

    try {
      const publicClient = this.requirePublicClient();
      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .withPayload(true)
        .where([
          eq('type', 'metadata'),
          eq('owner', owner)
        ]);

      let result = await query.fetch();
      const entities = [...result.entities];
      while (result.hasNextPage()) {
        await result.next();
        entities.push(...result.entities);
      }

      return entities
        .map(entity => {
          const metadata = this.parseMetadataPayload(entity);
          return {
            ...metadata,
            created_at: new Date(metadata.created_at),
            entity_key: entity.key,
            owner: metadata.owner
          };
        })
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    } catch (error) {
      console.error('❌ Failed to get files by owner:', error);
      return [];
    }
  }

  async getFileEntityKeys(file_id: string): Promise<{ metadata_key?: string; chunk_keys: string[] }> {
    await this.initialize();

    const ownerAddress = await this.getStorageOwnerAddress();
    if (!ownerAddress) {
      console.error('❌ Cannot get entity keys without owner address');
      return { chunk_keys: [] };
    }

    try {
      const publicClient = this.requirePublicClient();
      const query = publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .withAttributes(true)
        .where([
          eq('file_id', file_id)
        ]);

      let result = await query.fetch();
      const entities = [...result.entities];
      while (result.hasNextPage()) {
        await result.next();
        entities.push(...result.entities);
      }

      let metadata_key: string | undefined;
      const chunkKeys: { key: string; index: number }[] = [];

      entities.forEach(entity => {
        const attributeMap = this.attributesToMap(entity.attributes);
        const type = String(attributeMap.get('type') ?? '');
        if (type === 'metadata') {
          metadata_key = entity.key;
        } else if (type === 'chunk') {
          const chunkIndex = Number(attributeMap.get('chunk_index') ?? -1);
          chunkKeys.push({ key: entity.key, index: chunkIndex });
        }
      });

      const sortedChunkKeys = chunkKeys.sort((a, b) => a.index - b.index).map(({ key }) => key);

      return { metadata_key, chunk_keys: sortedChunkKeys };
    } catch (error) {
      console.error('❌ Failed to get file entity keys:', error);
      return { chunk_keys: [] };
    }
  }

  private async updateBlockTiming(): Promise<void> {
    if (!this.publicClient) {
      return;
    }

    try {
      const timing = await this.publicClient.getBlockTiming();
      if (timing.blockDuration > 0) {
        this.blockDurationSeconds = timing.blockDuration;
        console.log(`⏱️ Block duration updated to ${this.blockDurationSeconds}s`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch block timing, using default block time');
    }
  }

  private buildChunkPayload(chunk: ChunkEntity, expiresIn: number): ArkivEntityCreatePayload {
    return {
      payload: chunk.data,
      contentType: DEFAULT_CONTENT_TYPE,
      expiresIn,
      attributes: [
        { key: 'type', value: 'chunk' },
        { key: 'file_id', value: chunk.file_id },
        { key: 'chunk_index', value: chunk.chunk_index + 1 },
        { key: 'checksum', value: chunk.checksum },
        { key: 'created_at', value: chunk.created_at.toISOString() },
        { key: 'chunk_size', value: chunk.data.length },
        { key: 'expiration_block', value: chunk.expiration_block }
      ]
    };
  }

  private buildMetadataPayload(metadata: FileMetadata, expiresIn: number): ArkivEntityCreatePayload {
    const metadataJson = JSON.stringify({
      file_id: metadata.file_id,
      original_filename: metadata.original_filename,
      content_type: metadata.content_type,
      file_extension: metadata.file_extension,
      total_size: metadata.total_size,
      chunk_count: metadata.chunk_count,
      checksum: metadata.checksum,
      created_at: metadata.created_at.toISOString(),
      btl_days: metadata.btl_days,
      owner: metadata.owner
    });

    const attributes: Attribute[] = [
      { key: 'type', value: 'metadata' },
      { key: 'file_id', value: metadata.file_id },
      { key: 'original_filename', value: metadata.original_filename },
      { key: 'content_type', value: metadata.content_type },
      { key: 'file_extension', value: metadata.file_extension },
      { key: 'checksum', value: metadata.checksum },
      { key: 'total_size', value: metadata.total_size },
      { key: 'chunk_count', value: metadata.chunk_count },
      { key: 'expiration_block', value: metadata.expiration_block },
      { key: 'btl_days', value: metadata.btl_days }
    ];

    if (metadata.owner) {
      attributes.push({ key: 'owner', value: metadata.owner });
    }

    return {
      payload: Buffer.from(metadataJson, 'utf-8'),
      contentType: METADATA_CONTENT_TYPE,
      expiresIn,
      attributes
    };
  }

  private attributesToMap(attributes: Attribute[]): Map<string, string | number> {
    return attributes.reduce((map, attribute) => {
      map.set(attribute.key, attribute.value);
      return map;
    }, new Map<string, string | number>());
  }

  private parseMetadataPayload(entity: { payload?: Uint8Array; attributes: Attribute[] }): FileMetadata {
    const payload = entity.payload ? Buffer.from(entity.payload).toString('utf-8') : '{}';
    const data = JSON.parse(payload);
    return {
      file_id: data.file_id,
      original_filename: data.original_filename,
      content_type: data.content_type,
      file_extension: data.file_extension,
      total_size: data.total_size,
      chunk_count: data.chunk_count,
      checksum: data.checksum,
      created_at: new Date(data.created_at),
      expiration_block: Number(data.expiration_block || this.attributesToMap(entity.attributes).get('expiration_block') || 0),
      btl_days: Number(data.btl_days || this.attributesToMap(entity.attributes).get('btl_days') || 0),
      owner: data.owner
    };
  }

  private async computeExpiresInSeconds(targetBlock: number): Promise<number> {
    const currentBlock = await this.getCurrentBlock();
    return this.blocksToSeconds(Math.max(targetBlock - currentBlock, 1));
  }

  private blocksToSeconds(blocks: number): number {
    return Math.max(blocks, 1) * this.blockDurationSeconds;
  }

  private estimateCurrentBlock(): number {
    return Math.floor(Date.now() / 1000 / this.blockDurationSeconds);
  }

  private normalizeHex(value?: string): Hex | undefined {
    if (!value) {
      return undefined;
    }
    return this.ensureHexPrefix(value) as Hex;
  }

  private ensureHexPrefix(value: string): string {
    return value.startsWith('0x') ? value : `0x${value}`;
  }

  private resolveChain(chainId: number, rpcUrl: string, wsUrl?: string): Chain {
    const predefined = this.getPredefinedChain(chainId);
    if (predefined) {
      return predefined;
    }

    const httpUrls = [rpcUrl] as const;
    const webSocketUrls = wsUrl ? ([wsUrl] as const) : undefined;

    return defineChain({
      id: chainId,
      name: `arkiv-${chainId}`,
      network: `arkiv-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: {
          http: httpUrls,
          webSocket: webSocketUrls
        }
      },
      testnet: true
    });
  }

  private getPredefinedChain(chainId: number): Chain | undefined {
    switch (chainId) {
      case kaolin.id:
        return kaolin;
      case marketplace.id:
        return marketplace;
      case mendoza.id:
        return mendoza;
      case localhost.id:
        return localhost;
      default:
        return undefined;
    }
  }

  private requireWalletClient(): WalletArkivClient {
    if (!this.walletClient) {
      throw new Error('Write operations not available - no private key configured');
    }
    return this.walletClient;
  }

  private requirePublicClient(): PublicArkivClient {
    if (!this.publicClient) {
      throw new Error('Public client not initialized');
    }
    return this.publicClient;
  }

  private async getStorageOwnerAddress(): Promise<Hex | undefined> {
    await this.initialize();
    return this.chainOwnerAddress || this.configuredOwnerAddress;
  }

  private async retryBlockchainOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

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

        const delay = baseDelay * 2 ** (attempt - 1);
        console.warn(`⚠️ Attempt ${attempt} failed for ${operationName}, retrying in ${delay}ms:`, error instanceof Error ? error.message : error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error(`Unknown error during ${operationName}`);
  }
}

