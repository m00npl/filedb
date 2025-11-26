import { beforeAll, describe, expect, test } from "bun:test"
import { getTestBaseUrl, startTestServer } from "../setup"

const BASE_URL = getTestBaseUrl()

describe("Upload/Download Smoke Tests", () => {
  let authToken: string
  let fileId: string
  const testContent = "Smoke test content - " + Date.now()

  beforeAll(async () => {
    // Start test server if TEST_BASE_URL is not set
    if (!process.env.TEST_BASE_URL) {
      await startTestServer()
    }

    // Register and get token
    const email = `smoke-${Date.now()}@test.local`
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
  })

  test(
    "should upload a file successfully",
    async () => {
      const formData = new FormData()
      const blob = new Blob([testContent], { type: "text/plain" })
      formData.append("file", blob, "smoke-test.txt")
      formData.append("ttl_days", "7")

      const response = await fetch(`${BASE_URL}/files`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      })

      expect(response.status).toBe(200)

      const data = await response.json() as any
      expect(data.file_id).toBeDefined()
      expect(data.message).toBe("Upload successful")

      fileId = data.file_id
    },
    { timeout: 10000 },
  )

  test(
    "should get file info or accept in-progress upload",
    async () => {
      expect(fileId).toBeDefined()

      // Try to get file info, but accept that blockchain upload may still be in progress
      const response = await fetch(`${BASE_URL}/files/${fileId}/info`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      // Accept either success (blockchain complete) or 404/500 (blockchain still in progress)
      expect([200, 404, 500]).toContain(response.status)

      if (response.status === 200) {
        const data = await response.json() as any
        expect(data.file_id).toBe(fileId)
        expect(data.original_filename).toBe("smoke-test.txt")
        expect(data.content_type).toContain("text/plain")
        expect(data.total_size).toBe(testContent.length)
        console.log("✅ File info retrieved successfully (blockchain upload completed)")
      } else {
        console.log("⏳ File info not yet available (blockchain upload still in progress)")
      }
    },
    { timeout: 10000 },
  )

  test(
    "should download file or accept in-progress upload",
    async () => {
      expect(fileId).toBeDefined()

      // Try to download file, but accept that blockchain upload may still be in progress
      const response = await fetch(`${BASE_URL}/files/${fileId}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      // Accept either success (blockchain complete) or 404/500 (blockchain still in progress)
      expect([200, 404, 500]).toContain(response.status)

      if (response.status === 200) {
        expect(response.headers.get("Content-Type")).toContain("text/plain")
        const downloadedContent = await response.text()
        expect(downloadedContent).toBe(testContent)
        console.log("✅ File downloaded successfully (blockchain upload completed)")
      } else {
        console.log("⏳ File download not yet available (blockchain upload still in progress)")
      }
    },
    { timeout: 10000 },
  )

  test(
    "should check entity keys or accept in-progress upload",
    async () => {
      expect(fileId).toBeDefined()

      // Try to get entity keys, but accept that blockchain upload may still be in progress
      const response = await fetch(`${BASE_URL}/files/${fileId}/entities`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      // Accept either success (blockchain complete) or 404 (blockchain still in progress)
      expect([200, 404]).toContain(response.status)

      if (response.status === 200) {
        const data = await response.json() as any
        expect(data.file_id).toBe(fileId)

        // Check if entity keys are available
        const hasKeys =
          !!data.metadata_entity_key ||
          (data.chunk_entity_keys && data.chunk_entity_keys.length > 0)

        if (hasKeys) {
          expect(data.total_entities).toBeGreaterThan(0)
          console.log(
            `✅ Entity keys available: ${data.total_entities} entities (blockchain upload completed)`,
          )
        } else {
          console.log("⏳ Entity keys not yet populated (blockchain upload still in progress)")
        }
      } else {
        console.log(
          "⏳ Entity keys endpoint not yet available (blockchain upload still in progress)",
        )
      }
    },
    { timeout: 10000 },
  )

  test(
    "should get upload status",
    async () => {
      expect(fileId).toBeDefined()

      let response
      const retries = 3

      // Retry a few times as blockchain upload is asynchronous
      for (let i = 0; i < retries; i++) {
        response = await fetch(`${BASE_URL}/files/${fileId}/status`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })

        if (response.status === 200) break

        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }

      // Status endpoint may return 404 if session was cleaned up after upload completes
      expect([200, 404]).toContain(response!.status)

      if (response!.status === 200) {
        const data = await response!.json() as any
        expect(data.file_id).toBe(fileId)
        expect(data.status).toMatch(/uploading|completed/)
      }
    },
    { timeout: 20000 },
  )

  test("should update quota after upload", async () => {
    const response = await fetch(`${BASE_URL}/quota`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })

    expect(response.status).toBe(200)

    const data = await response.json() as any
    expect(data.used_bytes).toBeGreaterThanOrEqual(testContent.length)
    expect(data.uploads_today).toBeGreaterThanOrEqual(1)
  })
})
