import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"
import { ReadInput, UpdateInput, UpdateResult, View } from "./schema.js"

export const TaskMemory = Rpc.define({
  id: "task-memory",
  methods: {
    read: { input: ReadInput, output: View, errors: { invalid_state: z.strictObject({}) } },
    update: { input: UpdateInput, output: UpdateResult, errors: { invalid_state: z.strictObject({}) } },
  },
  events: {
    updated: { schema: z.strictObject({ projectID: z.string() }) },
  },
})
