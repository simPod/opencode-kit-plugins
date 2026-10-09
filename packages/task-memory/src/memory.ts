import { randomUUID } from "node:crypto"
import { Change, State, type Task, type View } from "./schema.js"

export interface Storage {
  get(key: string): Promise<unknown>
  set(key: string, value: State): Promise<void>
}

// All location instances in the shared server serialize writes to the same project.
const writes = new Map<string, Promise<unknown>>()

export class MemoryError extends Error {}

export class Memory {
  constructor(private readonly storage: Storage, private readonly projectID: string) {}

  private key() {
    return `projects/${this.projectID}/v1`
  }

  private async load(): Promise<State> {
    const saved = await this.storage.get(this.key())
    if (saved === undefined) return { bindings: {}, tasks: {}, version: 1 }
    return State.parse(saved)
  }

  async view(sessionID: string, taskID?: string): Promise<View> {
    await writes.get(this.key())?.catch(() => {})
    return this.select(await this.load(), sessionID, taskID)
  }

  private select(state: State, sessionID: string, taskID?: string): View {
    const selected = taskID ?? state.bindings[sessionID]
    const task = selected && Object.hasOwn(state.tasks, selected) ? state.tasks[selected] : null
    if (selected && !task) throw new MemoryError("Task not found in this project.")
    return {
      task: task ?? null,
      tasks: Object.values(state.tasks)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((task) => ({
          blockingQuestions: task.questions.filter((q) => q.blocking && q.answers.length === 0).length,
          id: task.id,
          status: currentStatus(task),
          title: task.title,
          updatedAt: task.updatedAt,
        })),
    }
  }

  update(sessionID: string, input: unknown): Promise<View> {
    const change = Change.parse(input)
    const key = this.key()
    const previous = writes.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(async () => {
      const state = await this.load()
      const at = new Date().toISOString()
      if (change.operation === "create") {
        const id = randomUUID()
        state.tasks[id] = {
          checkpoints: [], createdAt: at, decisions: [], id, questions: [],
          sessions: [sessionID], title: change.title, updatedAt: at,
        }
        state.bindings[sessionID] = id
      } else if (change.operation === "link") {
        const task = Object.hasOwn(state.tasks, change.taskID) ? state.tasks[change.taskID] : undefined
        if (!task) throw new MemoryError("Task not found in this project.")
        state.bindings[sessionID] = task.id
        if (!task.sessions.includes(sessionID)) task.sessions.push(sessionID)
        task.updatedAt = at
      } else {
        const taskID = state.bindings[sessionID]
        const task = taskID ? state.tasks[taskID] : undefined
        if (!task) throw new MemoryError("Create or link a task before updating it.")
        this.apply(task, change, sessionID, at)
        task.updatedAt = at
      }
      await this.storage.set(key, state)
      return this.select(state, sessionID)
    })
    writes.set(key, result)
    void result.finally(() => {
      if (writes.get(key) === result) writes.delete(key)
    }).catch(() => {})
    return result
  }

  private apply(task: Task, change: Exclude<Change, { operation: "create" | "link" }>, sessionID: string, at: string) {
    switch (change.operation) {
      case "decision": {
        const id = change.decisionID ?? randomUUID()
        if (change.decisionID && !task.decisions.some((decision) => decision.id === id)) {
          throw new MemoryError("Decision not found in the linked task.")
        }
        task.decisions.push({ at, id, reason: change.reason, sessionID, status: change.status, text: change.text })
        break
      }
      case "question":
        task.questions.push({ answers: [], at, blocking: change.blocking, id: randomUUID(), sessionID, text: change.text })
        break
      case "answer": {
        const question = task.questions.find((question) => question.id === change.questionID)
        if (!question) throw new MemoryError("Question not found in the linked task.")
        question.answers.push({ at, sessionID, text: change.answer })
        break
      }
      case "checkpoint":
        if (change.status === "completed" && (
          change.remaining.length > 0 || change.needsInput.length > 0 ||
          task.questions.some((question) => question.blocking && question.answers.length === 0)
        )) throw new MemoryError("A task cannot be completed while work or blocking input remains.")
        task.checkpoints.push({
          at, done: change.done, needsInput: change.needsInput, remaining: change.remaining,
          sessionID, status: change.status, summary: change.summary,
        })
    }
  }
}

export function latestDecisions(task: Task) {
  return [...new Map(task.decisions.map((decision) => [decision.id, decision])).values()]
}

export function currentStatus(task: Task): "active" | "completed" {
  if (task.questions.some((question) => question.blocking && question.answers.length === 0)) return "active"
  return task.checkpoints.at(-1)?.status ?? "active"
}

export function taskContext(task: Task): string {
  const checkpoint = task.checkpoints.at(-1)
  const open = task.questions.filter((question) => question.answers.length === 0)
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
  const blockingCount = open.filter((question) => question.blocking).length
  const short = (text: string, limit = 200) => text.length > limit ? `${text.slice(0, limit)}…` : text
  const section = <Item>(label: string, entries: Item[], limit: number, line: (entry: Item) => string) => [
    label,
    ...entries.slice(0, limit).map(line),
    ...(entries.length > limit ? [`- ${entries.length - limit} more omitted; use task_memory_view to inspect.`] : []),
  ]
  return [
    `Task: ${short(task.title, 240)} (${task.id})`,
    `Status: ${currentStatus(task)}`,
    `Unanswered blocking questions: ${blockingCount}`,
    ...(blockingCount > 0 ? ["Stop work that depends on these answers. Inspect omitted questions before proceeding."] : []),
    ...section("Unanswered questions:", open, 8,
      (question) => `- ${question.blocking ? "BLOCKING" : "Open"}: ${short(question.text, 240)} (${question.id})`),
    ...(checkpoint ? [
      `Checkpoint: ${short(checkpoint.summary, 500)}`,
      ...section("Done:", checkpoint.done, 5, (item) => `- ${short(item, 160)}`),
      ...section("Remaining:", checkpoint.remaining, 5, (item) => `- ${short(item, 160)}`),
      ...section("Needs input:", checkpoint.needsInput, 5, (item) => `- ${short(item, 160)}`),
    ] : ["No checkpoint recorded."]),
    ...section("Recent decisions:", latestDecisions(task).reverse(), 6,
      (decision) => `- ${decision.status}: ${short(decision.text)}. Reason: ${short(decision.reason, 160)}`),
    ...section("Recent answers:", task.questions.filter((question) => question.answers.length > 0).reverse(), 4,
      (question) => `- ${short(question.text, 160)}: ${short(question.answers.at(-1)?.text ?? "", 160)}`),
    "This is a bounded summary. Use task_memory_view for complete decisions, questions, and history.",
  ].join("\n").slice(0, 12_000)
}
