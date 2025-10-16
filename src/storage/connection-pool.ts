import { createClient, createROClient } from 'golem-base-sdk';

export interface PooledConnection {
  id: string;
  client: any;
  isWriteClient: boolean;
  isActive: boolean;
  lastUsed: Date;
  createdAt: Date;
  useCount: number;
}

export interface ConnectionPoolConfig {
  maxWriteConnections: number;
  maxReadConnections: number;
  maxIdleTime: number; // milliseconds
  healthCheckInterval: number; // milliseconds
  retryAttempts: number;
  connectionTimeout: number; // milliseconds
}

export class GolemDBConnectionPool {
  private writeConnections: PooledConnection[] = [];
  private readConnections: PooledConnection[] = [];
  private waitingForWrite: ((connection: PooledConnection) => void)[] = [];
  private waitingForRead: ((connection: PooledConnection) => void)[] = [];
  private healthCheckTimer: Timer | null = null;
  private isShutdown = false;

  private config: ConnectionPoolConfig = {
    maxWriteConnections: 5,
    maxReadConnections: 10,
    maxIdleTime: 300000, // 5 minutes
    healthCheckInterval: 60000, // 1 minute
    retryAttempts: 3,
    connectionTimeout: 30000 // 30 seconds
  };

  constructor(
    private chainId: number,
    private rpcUrl: string,
    private wsUrl: string,
    private privateKey?: string,
    config?: Partial<ConnectionPoolConfig>
  ) {
    this.config = { ...this.config, ...config };
    this.startHealthCheck();
  }

  async initialize(): Promise<void> {
    console.log('🔗 Initializing Golem DB connection pool...');

    // Create initial read connections
    const readPromises = Array.from({ length: Math.min(2, this.config.maxReadConnections) }, () =>
      this.createReadConnection()
    );

    // Create initial write connections if private key available
    const writePromises = this.privateKey
      ? Array.from({ length: Math.min(1, this.config.maxWriteConnections) }, () =>
          this.createWriteConnection()
        )
      : [];

    await Promise.allSettled([...readPromises, ...writePromises]);

    console.log(`✅ Connection pool initialized: ${this.writeConnections.length} write, ${this.readConnections.length} read`);
  }

  async getWriteConnection(): Promise<PooledConnection> {
    if (this.isShutdown) {
      throw new Error('Connection pool is shutdown');
    }

    if (!this.privateKey) {
      throw new Error('Write operations not available - no private key configured');
    }

    // Try to get an available connection
    const available = this.writeConnections.find(conn => !conn.isActive);
    if (available) {
      available.isActive = true;
      available.lastUsed = new Date();
      available.useCount++;
      return available;
    }

    // Create new connection if under limit
    if (this.writeConnections.length < this.config.maxWriteConnections) {
      const newConn = await this.createWriteConnection();
      newConn.isActive = true;
      return newConn;
    }

    // Wait for available connection
    return this.waitForConnection(this.waitingForWrite);
  }

  async getReadConnection(): Promise<PooledConnection> {
    if (this.isShutdown) {
      throw new Error('Connection pool is shutdown');
    }

    // Try to get an available connection
    const available = this.readConnections.find(conn => !conn.isActive);
    if (available) {
      available.isActive = true;
      available.lastUsed = new Date();
      available.useCount++;
      return available;
    }

    // Create new connection if under limit
    if (this.readConnections.length < this.config.maxReadConnections) {
      const newConn = await this.createReadConnection();
      newConn.isActive = true;
      return newConn;
    }

    // Wait for available connection
    return this.waitForConnection(this.waitingForRead);
  }

  releaseConnection(connection: PooledConnection): void {
    connection.isActive = false;
    connection.lastUsed = new Date();

    // Notify waiting requests
    const waitQueue = connection.isWriteClient ? this.waitingForWrite : this.waitingForRead;
    const next = waitQueue.shift();
    if (next) {
      connection.isActive = true;
      next(connection);
    }
  }

  async executeWithWriteConnection<T>(operation: (client: any) => Promise<T>): Promise<T> {
    const connection = await this.getWriteConnection();
    try {
      return await this.executeWithRetry(() => operation(connection.client));
    } finally {
      this.releaseConnection(connection);
    }
  }

  async executeWithReadConnection<T>(operation: (client: any) => Promise<T>): Promise<T> {
    const connection = await this.getReadConnection();
    try {
      return await this.executeWithRetry(() => operation(connection.client));
    } finally {
      this.releaseConnection(connection);
    }
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.config.retryAttempts) {
          throw error;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`⚠️ Connection operation failed (attempt ${attempt}), retrying in ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  private async createWriteConnection(): Promise<PooledConnection> {
    if (!this.privateKey) {
      throw new Error('Cannot create write connection without private key');
    }

    const id = `write-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const hexKey = this.privateKey.replace('0x', '');
      const accountData = {
        tag: 'privatekey',
        data: Buffer.from(hexKey, 'hex')
      } as const;

      const client = await Promise.race([
        createClient(this.chainId, accountData, this.rpcUrl, this.wsUrl),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout)
        )
      ]);

      const connection: PooledConnection = {
        id,
        client,
        isWriteClient: true,
        isActive: false,
        lastUsed: new Date(),
        createdAt: new Date(),
        useCount: 0
      };

      this.writeConnections.push(connection);
      console.log(`✅ Created write connection ${id}`);

      return connection;
    } catch (error) {
      console.error(`❌ Failed to create write connection ${id}:`, error);
      throw error;
    }
  }

  private async createReadConnection(): Promise<PooledConnection> {
    const id = `read-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const client = await Promise.race([
        createROClient(this.chainId, this.rpcUrl, this.wsUrl),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout)
        )
      ]);

      const connection: PooledConnection = {
        id,
        client,
        isWriteClient: false,
        isActive: false,
        lastUsed: new Date(),
        createdAt: new Date(),
        useCount: 0
      };

      this.readConnections.push(connection);
      console.log(`✅ Created read connection ${id}`);

      return connection;
    } catch (error) {
      console.error(`❌ Failed to create read connection ${id}:`, error);
      throw error;
    }
  }

  private async waitForConnection(waitQueue: ((connection: PooledConnection) => void)[]): Promise<PooledConnection> {
    return new Promise((resolve) => {
      waitQueue.push(resolve);
    });
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const now = new Date();

    // Check for idle connections to close
    const idleConnections = [
      ...this.writeConnections.filter(conn =>
        !conn.isActive && (now.getTime() - conn.lastUsed.getTime()) > this.config.maxIdleTime
      ),
      ...this.readConnections.filter(conn =>
        !conn.isActive && (now.getTime() - conn.lastUsed.getTime()) > this.config.maxIdleTime
      )
    ];

    for (const conn of idleConnections) {
      await this.closeConnection(conn);
    }

    // Log pool statistics
    const stats = this.getPoolStats();
    if (stats.totalConnections > 0) {
      console.log(`🔍 Pool health: ${stats.writeActive}/${stats.writeTotal} write, ${stats.readActive}/${stats.readTotal} read active`);
    }
  }

  private async closeConnection(connection: PooledConnection): Promise<void> {
    try {
      // Remove from appropriate pool
      if (connection.isWriteClient) {
        this.writeConnections = this.writeConnections.filter(c => c.id !== connection.id);
      } else {
        this.readConnections = this.readConnections.filter(c => c.id !== connection.id);
      }

      console.log(`🔌 Closed idle connection ${connection.id} (used ${connection.useCount} times)`);
    } catch (error) {
      console.error(`❌ Error closing connection ${connection.id}:`, error);
    }
  }

  getPoolStats() {
    return {
      writeTotal: this.writeConnections.length,
      writeActive: this.writeConnections.filter(c => c.isActive).length,
      readTotal: this.readConnections.length,
      readActive: this.readConnections.filter(c => c.isActive).length,
      totalConnections: this.writeConnections.length + this.readConnections.length,
      waitingForWrite: this.waitingForWrite.length,
      waitingForRead: this.waitingForRead.length
    };
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down connection pool...');
    this.isShutdown = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Close all connections
    const allConnections = [...this.writeConnections, ...this.readConnections];
    await Promise.allSettled(allConnections.map(conn => this.closeConnection(conn)));

    // Clear waiting queues
    this.waitingForWrite.forEach(resolve => resolve({} as PooledConnection));
    this.waitingForRead.forEach(resolve => resolve({} as PooledConnection));

    this.writeConnections = [];
    this.readConnections = [];
    this.waitingForWrite = [];
    this.waitingForRead = [];

    console.log('✅ Connection pool shutdown complete');
  }
}