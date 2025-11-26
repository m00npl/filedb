import { createClient, type RedisClientType } from "redis"
import type { UploadSession } from "../types"

export interface RedisConfig {
  url: string
  keyPrefix: string
  defaultTTL: number // in seconds
}

export class RedisSessionStore {
  private client: RedisClientType
  private config: RedisConfig
  private isConnected: boolean = false

  constructor(config?: Partial<RedisConfig>) {
    this.config = {
      url: config?.url || process.env.REDIS_URL || "redis://localhost:6379",
      keyPrefix: config?.keyPrefix || "filedb:session:",
      defaultTTL: config?.defaultTTL || 3600, // 1 hour
    }

    this.client = createClient({
      url: this.config.url,
      socket: {
        lazyConnect: true,
      },
    } as any)

    this.client.on("error", (error) => {
      console.error("❌ Redis connection error:", error)
      this.isConnected = false
    })

    this.client.on("connect", () => {
      console.log("🔗 Connected to Redis")
      this.isConnected = true
    })

    this.client.on("disconnect", () => {
      console.log("🔌 Disconnected from Redis")
      this.isConnected = false
    })
  }

  async initialize(): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.client.connect()
      }
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.client.disconnect()
      }
    } catch (error) {
      console.error("❌ Error disconnecting from Redis:", error)
    }
  }

  private getKey(sessionId: string): string {
    return `${this.config.keyPrefix}${sessionId}`
  }

  async setSession(sessionId: string, session: UploadSession, ttl?: number): Promise<void> {
    try {
      const key = this.getKey(sessionId)
      const sessionData = JSON.stringify({
        ...session,
        chunks_received: Array.from(session.chunks_received),
        started_at: session.started_at.toISOString(),
        last_chunk_uploaded_at: session.last_chunk_uploaded_at?.toISOString(),
        metadata: {
          ...session.metadata,
          created_at: session.metadata.created_at.toISOString(),
        },
      })

      const expiry = ttl || this.config.defaultTTL
      await this.client.setEx(key, expiry, sessionData)
    } catch (error) {
      console.error("❌ Error saving session to Redis:", error)
      throw error
    }
  }

  async getSession(sessionId: string): Promise<UploadSession | null> {
    try {
      const key = this.getKey(sessionId)
      const sessionData = await this.client.get(key)

      if (!sessionData) {
        return null
      }

      const parsed = JSON.parse(sessionData)

      // Reconstruct the session object with proper types
      return {
        ...parsed,
        chunks_received: new Set(parsed.chunks_received),
        started_at: new Date(parsed.started_at),
        last_chunk_uploaded_at: parsed.last_chunk_uploaded_at
          ? new Date(parsed.last_chunk_uploaded_at)
          : undefined,
        metadata: {
          ...parsed.metadata,
          created_at: new Date(parsed.metadata.created_at),
        },
      } as UploadSession
    } catch (error) {
      console.error("❌ Error retrieving session from Redis:", error)
      return null
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const key = this.getKey(sessionId)
      await this.client.del(key)
    } catch (error) {
      console.error("❌ Error deleting session from Redis:", error)
      throw error
    }
  }

  async getAllSessions(): Promise<Map<string, UploadSession>> {
    try {
      const pattern = `${this.config.keyPrefix}*`
      const keys: string[] = []

      // Use SCAN instead of KEYS to avoid blocking Redis
      for await (const key of this.client.scanIterator({ MATCH: pattern, TYPE: "string" })) {
        // scanIterator returns strings for keys
        if (typeof key === "string") {
          keys.push(key)
        }
      }

      const sessions = new Map<string, UploadSession>()

      for (const key of keys) {
        const sessionId = key.replace(this.config.keyPrefix, "")
        const session = await this.getSession(sessionId)
        if (session) {
          sessions.set(sessionId, session)
        }
      }

      return sessions
    } catch (error) {
      console.error("❌ Error retrieving all sessions from Redis:", error)
      return new Map()
    }
  }

  async getSessionsByFileId(fileId: string): Promise<UploadSession[]> {
    try {
      const allSessions = await this.getAllSessions()
      const matchingSessions: UploadSession[] = []

      for (const session of allSessions.values()) {
        if (session.file_id === fileId) {
          matchingSessions.push(session)
        }
      }

      return matchingSessions
    } catch (error) {
      console.error("❌ Error retrieving sessions by file ID from Redis:", error)
      return []
    }
  }

  async extendSessionTTL(sessionId: string, ttl?: number): Promise<void> {
    try {
      const key = this.getKey(sessionId)
      const expiry = ttl || this.config.defaultTTL
      await this.client.expire(key, expiry)
    } catch (error) {
      console.error("❌ Error extending session TTL in Redis:", error)
      throw error
    }
  }

  async getSessionCount(): Promise<number> {
    try {
      const pattern = `${this.config.keyPrefix}*`
      let count = 0

      // Use SCAN instead of KEYS to avoid blocking Redis
      for await (const key of this.client.scanIterator({ MATCH: pattern, TYPE: "string" })) {
        if (typeof key === "string") {
          count++
        }
      }

      return count
    } catch (error) {
      console.error("❌ Error getting session count from Redis:", error)
      return 0
    }
  }

  async clearAllSessions(): Promise<void> {
    try {
      const pattern = `${this.config.keyPrefix}*`
      const keys: string[] = []

      // Use SCAN instead of KEYS to avoid blocking Redis
      for await (const key of this.client.scanIterator({ MATCH: pattern, TYPE: "string" })) {
        if (typeof key === "string") {
          keys.push(key)
        }
      }

      if (keys.length > 0) {
        await this.client.del(keys)
        console.log(`🗑️ Cleared ${keys.length} sessions from Redis`)
      }
    } catch (error) {
      console.error("❌ Error clearing all sessions from Redis:", error)
      throw error
    }
  }

  isRedisConnected(): boolean {
    return this.isConnected
  }

  async ping(): Promise<string> {
    try {
      return await this.client.ping()
    } catch (error) {
      console.error("❌ Redis ping failed:", error)
      throw error
    }
  }

  async setFileEntityKeys(
    fileId: string,
    entityKeys: { metadata_key?: string; chunk_keys: string[] },
    ttl?: number,
  ): Promise<void> {
    try {
      const key = `${this.config.keyPrefix}entity_keys:${fileId}`
      const data = JSON.stringify(entityKeys)
      const expiry = ttl || this.config.defaultTTL
      await this.client.setEx(key, expiry, data)
    } catch (error) {
      console.error("❌ Error saving entity keys to Redis:", error)
      throw error
    }
  }

  async getFileEntityKeys(
    fileId: string,
  ): Promise<{ metadata_key?: string; chunk_keys: string[] } | null> {
    try {
      const key = `${this.config.keyPrefix}entity_keys:${fileId}`
      const data = await this.client.get(key)

      if (!data) {
        return null
      }

      return JSON.parse(data)
    } catch (error) {
      console.error("❌ Error retrieving entity keys from Redis:", error)
      return null
    }
  }

  // Generic cache methods for quota and other services
  async getSessionData(key: string): Promise<string | null> {
    try {
      return await this.client.get(key)
    } catch (error) {
      console.error(`❌ Error getting data for ${key}:`, error)
      return null
    }
  }

  async storeSessionData(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value)
      } else {
        await this.client.set(key, value)
      }
    } catch (error) {
      console.error(`❌ Error storing data for ${key}:`, error)
    }
  }

  async deleteSessionData(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      console.error(`❌ Error deleting data for ${key}:`, error)
    }
  }
}
