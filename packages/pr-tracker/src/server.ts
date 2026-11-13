import { randomUUID } from "node:crypto"
import { Plugin } from "@opencode/plugin"
import { PrTracker } from "./rpc"

type Completion = {
  rootSessionID: string
  removed: boolean
}

const TIMEOUT_MS = 15_000

export default Plugin.define({
  id: "kit.pr-tracker.server",
  async setup(context) {
    const pending = new Map<string, {
      rootSessionID: string
      resolve: (result: Completion) => void
      timer: ReturnType<typeof setTimeout>
    }>()

    const registration = await context.rpc.register(PrTracker, {
      untrack: async (raw, rpc) => {
        const { sessionID, url } = raw as { sessionID: string; url: string }
        if (rpc.signal.aborted) throw rpc.signal.reason
        const parsed = (() => {
          try {
            const value = new URL(url)
            const match = value.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)\/?$/)
            const iid = match ? Number(match[2]) : NaN
            if (
              !match || !["https:", "http:"].includes(value.protocol) ||
              value.username || value.password || !Number.isSafeInteger(iid) || iid < 1
            ) return undefined
            return `${value.origin}/${match[1]}/-/merge_requests/${iid}`
          } catch {
            return undefined
          }
        })()
        if (!parsed) throw new Error("Expected a full GitLab merge request URL")
        const session = await context.session.get({ sessionID }, { signal: rpc.signal })
        if (session.location.directory !== context.location.directory)
          throw new Error("The session does not belong to this OpenCode location")
        let root = session
        while (root.parentID) {
          root = await context.session.get({ sessionID: root.parentID }, { signal: rpc.signal })
        }
        if (root.location.directory !== context.location.directory)
          throw new Error("The session does not belong to this OpenCode location")

        const requestID = randomUUID()
        let onAbort: (() => void) | undefined
        const completion = new Promise<Completion>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestID)
            if (onAbort) rpc.signal.removeEventListener("abort", onAbort)
            reject(new Error("No TUI tracker is connected at this location"))
          }, TIMEOUT_MS)
          pending.set(requestID, { rootSessionID: root.id, resolve, timer })
          onAbort = () => {
            clearTimeout(timer)
            pending.delete(requestID)
            reject(rpc.signal.reason)
          }
          rpc.signal.addEventListener("abort", onAbort, { once: true })
        })
        await registration.events.emit("untrackRequested", {
          requestID,
          sessionID,
          rootSessionID: root.id,
          url: parsed,
        })
        const result = await completion.finally(() => {
          if (onAbort) rpc.signal.removeEventListener("abort", onAbort)
        })
        if (result.rootSessionID !== root.id)
          throw new Error("The TUI session family does not match the requested session")
        return { removed: result.removed, rootSessionID: root.id }
      },
      completeUntrack: async (raw) => {
        const { requestID, rootSessionID, removed } = raw as {
          requestID: string
          rootSessionID: string
          removed: boolean
        }
        const request = pending.get(requestID)
        if (!request) return { accepted: false }
        if (request.rootSessionID !== rootSessionID) return { accepted: false }
        clearTimeout(request.timer)
        pending.delete(requestID)
        request.resolve({ rootSessionID, removed })
        return { accepted: true }
      },
    })

    return async () => {
      for (const request of pending.values()) clearTimeout(request.timer)
      pending.clear()
      await registration.dispose()
    }
  },
})
