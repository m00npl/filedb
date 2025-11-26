import server from "../src/server"

let serverInstance: ReturnType<typeof Bun.serve> | null = null
let serverStarted = false
const TEST_PORT = parseInt(process.env.TEST_PORT || "3003")
const BASE_URL = `http://localhost:${TEST_PORT}`

export async function startTestServer(): Promise<string> {
  if (serverInstance && serverStarted) {
    return BASE_URL
  }

  // Set test port
  process.env.PORT = TEST_PORT.toString()

  // Start the server
  serverInstance = Bun.serve({
    port: TEST_PORT,
    fetch: server.fetch,
    idleTimeout: server.idleTimeout,
  })

  // Wait for server to be ready
  let retries = 30
  while (retries > 0) {
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) {
        serverStarted = true
        console.log(`✅ Test server started on port ${TEST_PORT}`)
        return BASE_URL
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    retries--
  }

  throw new Error(`Failed to start test server on port ${TEST_PORT}`)
}

export async function stopTestServer(): Promise<void> {
  if (serverInstance) {
    serverInstance.stop()
    serverInstance = null
    serverStarted = false
    console.log("🛑 Test server stopped")
  }
}

export function getTestBaseUrl(): string {
  // If TEST_BASE_URL is set, use it (for external server testing)
  // Otherwise, use the local test server
  return process.env.TEST_BASE_URL || BASE_URL
}

