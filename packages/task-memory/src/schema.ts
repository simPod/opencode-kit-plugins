import { z } from "zod"

const id = z.string().trim().min(1).max(128)
const text = z.string().trim().min(1).max(4000)
const items = z.array(text).max(30)
const origin = { at: z.string(), sessionID: id }

export const FindingKind = z.enum(["bug", "risk", "verification"])
export const FindingStatus = z.enum(["open", "resolved", "deferred"])
export const FindingScope = z.enum(["current", "project"])
export type FindingScope = z.infer<typeof FindingScope>
const findingFields = { kind: FindingKind, status: FindingStatus, text, reason: text }
export const Finding = z.strictObject({
  ...origin,
  ...findingFields,
  id,
  taskID: id.nullable(),
})
export type Finding = z.infer<typeof Finding>

export const Change = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create"), title: text }),
  z.strictObject({ operation: z.literal("link"), taskID: id }),
  z.strictObject({
    operation: z.literal("decision"),
    reason: text,
    status: z.enum(["accepted", "rejected"]),
    text,
    decisionID: id.optional(),
  }),
  z.strictObject({ operation: z.literal("question"), blocking: z.boolean(), text }),
  z.strictObject({ operation: z.literal("answer"), answer: text, questionID: id }),
  z.strictObject({
    operation: z.literal("finding"), ...findingFields, findingID: id.optional(),
    expectedRevision: z.number().int().positive().optional(),
  }),
  z.strictObject({
    operation: z.literal("checkpoint"),
    done: items,
    needsInput: items,
    remaining: items,
    status: z.enum(["active", "completed"]),
    summary: text,
  }),
])
export type Change = z.infer<typeof Change>

export const Task = z.strictObject({
  checkpoints: z.array(z.strictObject({
    ...origin,
    done: items,
    needsInput: items,
    remaining: items,
    status: z.enum(["active", "completed"]),
    summary: text,
  })),
  createdAt: z.string(),
  decisions: z.array(z.strictObject({
    ...origin,
    id,
    reason: text,
    status: z.enum(["accepted", "rejected"]),
    text,
  })),
  id,
  questions: z.array(z.strictObject({
    ...origin,
    answers: z.array(z.strictObject({ ...origin, text })),
    blocking: z.boolean(),
    id,
    text,
  })),
  sessions: z.array(id),
  title: text,
  updatedAt: z.string(),
})
export type Task = z.infer<typeof Task>

export const State = z.strictObject({
  bindings: z.record(z.string(), id),
  tasks: z.record(z.string(), Task),
  findings: z.array(Finding).default([]),
  version: z.literal(1),
})
export type State = z.infer<typeof State>

export const View = z.strictObject({
  scope: FindingScope,
  findings: z.array(Finding),
  task: Task.nullable(),
  tasks: z.array(z.strictObject({
    blockingQuestions: z.number().int().nonnegative(),
    id,
    status: z.enum(["active", "completed"]),
    title: text,
    updatedAt: z.string(),
  })),
})
export type View = z.infer<typeof View>

export const UpdateResult = z.strictObject({
  blockingQuestions: z.number().int().nonnegative(),
  status: z.enum(["active", "completed"]).nullable(),
  taskID: id.nullable(),
  title: text.nullable(),
  openFindings: z.number().int().nonnegative(),
  findingID: id.optional(),
  findingRevision: z.number().int().positive().optional(),
  checkpointAt: z.string().optional(),
  decisionID: id.optional(),
  questionID: id.optional(),
})

export const ReadInput = z.strictObject({ sessionID: id, taskID: id.optional(), scope: FindingScope.optional() })
export const UpdateInput = z.strictObject({ change: Change, sessionID: id })
