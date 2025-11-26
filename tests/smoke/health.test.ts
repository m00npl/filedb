import { beforeAll, describe, expect, test } from "bun:test"
import { getTestBaseUrl, startTestServer } from "../setup"

const BASE_URL = getTestBaseUrl()

describe("Health Check Smoke Tests", () => {
  beforeAll(async () => {
    // Start test server if TEST_BASE_URL is not set
    if (!process.env.TEST_BASE_URL) {
      await startTestServer()
    }
  })

  test("should return healthy status", async () => {
    const response = await fetch(`${BASE_URL}/health`)

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.status).toBe("healthy")
    expect(data.services).toBeDefined()
    expect(data.timestamp).toBeDefined()
  })

  test("should have Redis connection", async () => {
    const response = await fetch(`${BASE_URL}/health`)
    const data = await response.json() as any

    expect(data.services.redis).toMatch(/connected|unknown/)
  })

  test("should have database connection", async () => {
    const response = await fetch(`${BASE_URL}/health`)
    const data = await response.json() as any

    expect(data.services.database).toBe("connected")
  })
})
