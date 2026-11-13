import { Rpc } from "@opencode/plugin/rpc"

const string = { type: "string" } as const
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
}) as const

export const PrTracker = Rpc.define({
  id: "kit.pr-tracker",
  methods: {
    untrack: {
      input: object({ sessionID: string, url: string }, ["sessionID", "url"]),
      output: object({ removed: { type: "boolean" }, rootSessionID: string }, ["removed", "rootSessionID"]),
    },
    completeUntrack: {
      input: object({
        requestID: string,
        rootSessionID: string,
        removed: { type: "boolean" },
      }, ["requestID", "rootSessionID", "removed"]),
      output: object({ accepted: { type: "boolean" } }, ["accepted"]),
    },
  },
  events: {
    untrackRequested: {
      schema: object({
        requestID: string,
        sessionID: string,
        rootSessionID: string,
        url: string,
      }, ["requestID", "sessionID", "rootSessionID", "url"]),
    },
  },
})
