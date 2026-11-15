import { test } from "bun:test"
import { strict as assert } from "node:assert"
import type { Plugin } from "@opencode/plugin"
import plugin from "./server"

type Handler = (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>
type Methods = { untrack?: Handler; completeUntrack?: Handler }

test("RPC untrack validates session location and waits for the owning TUI acknowledgement", async () => {
  let methods: Methods = {}
  let request: unknown
  let ackRemoved = true
  const controller = new AbortController()
  const context = {
    location: { directory: "/project" },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (sessionID === "child") return { id: "child", parentID: "root", location: { directory: "/project" } }
        if (sessionID === "root") return { id: "root", location: { directory: "/project" } }
        if (sessionID === "other-location") return { id: "other-location", location: { directory: "/other" } }
        throw new Error("not found")
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: Record<string, Handler>) => {
        methods = handlers as Methods
        return {
          events: {
            emit: async (_name: string, data: unknown) => {
              request = data
              const requestID = (data as { requestID: string }).requestID
              assert.deepEqual(await methods.completeUntrack!({
                requestID,
                rootSessionID: "different-root",
                removed: true,
              }, { signal: controller.signal }), { accepted: false })
              await methods.completeUntrack!({
                requestID,
                rootSessionID: "root",
                removed: ackRemoved,
              }, { signal: controller.signal })
            },
          },
          dispose: async () => {},
        }
      },
    },
  } as unknown as Plugin.Context
  const cleanup = await plugin.setup(context)

  try {
    const result = await methods.untrack!(
      { sessionID: "child", url: "https://gitlab.example/team/app/-/merge_requests/42/" },
      { signal: controller.signal },
    )
    const emitted = request as { sessionID: string; rootSessionID: string; url: string }
    assert.deepEqual({
      sessionID: emitted.sessionID,
      rootSessionID: emitted.rootSessionID,
      url: emitted.url,
    }, {
      sessionID: "child",
      rootSessionID: "root",
      url: "https://gitlab.example/team/app/-/merge_requests/42",
    })
    assert.deepEqual(result, { removed: true, rootSessionID: "root" })
    assert.deepEqual(await methods.completeUntrack!({
      requestID: "unknown-request",
      rootSessionID: "root",
      removed: true,
    }, { signal: controller.signal }), { accepted: false })

    ackRemoved = false
    const startedAt = Date.now()
    const negative = await methods.untrack!(
      { sessionID: "child", url: "https://gitlab.example/team/app/-/merge_requests/42" },
      { signal: controller.signal },
    )
    assert.deepEqual(negative, { removed: false, rootSessionID: "root" })
    assert(Date.now() - startedAt < 500, "a same-family negative acknowledgement must finish without waiting for timeout")

    ackRemoved = true
    const github = await methods.untrack!(
      {
        sessionID: "child",
        url: "https://github.com/phpstan/phpstan-doctrine/pull/814/?tab=files#discussion",
      },
      { signal: controller.signal },
    )
    assert.deepEqual(github, { removed: true, rootSessionID: "root" })
    assert.equal((request as { url: string }).url, "https://github.com/phpstan/phpstan-doctrine/pull/814")

    await assert.rejects(methods.untrack!(
      { sessionID: "other-location", url: "https://gitlab.example/team/app/-/merge_requests/42" },
      { signal: controller.signal },
    ))
    await assert.rejects(methods.untrack!(
      { sessionID: "child", url: "42" },
      { signal: controller.signal },
    ))
    await assert.rejects(methods.untrack!(
      { sessionID: "child", url: "https://github.example/team/app/pull/42" },
      { signal: controller.signal },
    ))
    await assert.rejects(methods.untrack!(
      { sessionID: "child", url: "https://user:password@github.com/team/app/pull/42" },
      { signal: controller.signal },
    ))
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})
