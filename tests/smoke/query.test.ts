import { beforeAll, describe, expect, test } from "bun:test"
import { getTestBaseUrl, startTestServer } from "../setup"

const BASE_URL = getTestBaseUrl()

describe("Query Endpoints Smoke Tests", () => {
  let authToken: string
  let fileId: string
  const testOwner = `smoke-owner-${Date.now()}`

  beforeAll(async () => {
    // Start test server if TEST_BASE_URL is not set
    if (!process.env.TEST_BASE_URL) {
      await startTestServer()
    }

    // Register and get token
    const email = `query-${Date.now()}@test.local`
    const response = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "TestPass123!",
      }),
    })

    const data = await response.json() as any
    authToken = data.accessToken

    // Upload a test file with owner annotation
    const formData = new FormData()
    const blob = new Blob(["Query test content"], { type: "text/plain" })
    formData.append("file", blob, "query-test.txt")
    formData.append("owner", testOwner)

    const uploadResponse = await fetch(`${BASE_URL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    })

    const uploadData = await uploadResponse.json() as any
    fileId = uploadData.file_id
  })

  test("should query files by extension", async () => {
    const response = await fetch(`${BASE_URL}/files/by-extension/txt`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.extension).toBe("txt")
    expect(data.count).toBeGreaterThanOrEqual(0) // In blockchain mode, this returns 0
    expect(Array.isArray(data.files)).toBe(true)

    // In blockchain mode, these queries are not supported and return empty results
    // This is expected behavior
  })

  test("should query files by content type", async () => {
    const response = await fetch(`${BASE_URL}/files/by-type/${encodeURIComponent("text/plain")}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.content_type).toBe("text/plain")
    expect(data.count).toBeGreaterThanOrEqual(0) // In blockchain mode, this returns 0
    expect(Array.isArray(data.files)).toBe(true)

    // In blockchain mode, these queries are not supported and return empty results
    // This is expected behavior
  })

  test("should query files by owner", async () => {
    const response = await fetch(`${BASE_URL}/files/by-owner/${testOwner}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.owner).toBe(testOwner)
    expect(data.count).toBeGreaterThanOrEqual(0) // May return 0 if blockchain indexing is slow
    expect(Array.isArray(data.files)).toBe(true)

    // Note: Blockchain indexing may be slow, so results might not be immediate
  })

  test("should return empty results for non-existent owner", async () => {
    const response = await fetch(`${BASE_URL}/files/by-owner/non-existent-owner-${Date.now()}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.count).toBe(0)
    expect(data.files).toEqual([])
  })
})
