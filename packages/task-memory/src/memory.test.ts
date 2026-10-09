import { strict as assert } from "node:assert"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { latestDecisions, Memory, taskContext, type Storage } from "./memory.js"
import type { Change, State } from "./schema.js"

class DurableStorage implements Storage {
  private readonly values = new Map<string, State>()

  async get(key: string): Promise<unknown> {
    return structuredClone(this.values.get(key))
  }

  async set(key: string, value: State): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  snapshot() {
    return structuredClone(this.values)
  }
}

function fixture() {
  const storage = new DurableStorage()
  const projectID = randomUUID()
  return { memory: new Memory(storage, projectID), projectID, storage }
}

test("retains task history and resumes it from a linked session", async () => {
  const { memory, projectID, storage } = fixture()
  const created = await memory.update("first", { operation: "create", title: "Ship task memory" })
  assert(created.task)
  const taskID = created.task.id
  assert.equal(created.task.title, "Ship task memory")
  assert.deepEqual(created.task.sessions, ["first"])
  assert.equal(created.tasks[0]?.status, "active")

  const accepted = await memory.update("first", {
    operation: "decision", status: "accepted", text: "Use a shared file", reason: "Keep setup simple",
  })
  assert(accepted.task)
  const decision = accepted.task.decisions[0]
  assert(decision)
  await memory.update("first", {
    operation: "decision", decisionID: decision.id, status: "rejected",
    text: "Use a shared file", reason: "Separate projects need separate state",
  })
  await memory.update("first", {
    operation: "decision", status: "accepted", text: "Store state per project", reason: "Prevent project leaks",
  })
  const asked = await memory.update("first", {
    operation: "question", blocking: true, text: "Which storage location is approved?",
  })
  assert(asked.task)
  const blocking = asked.task.questions[0]
  assert(blocking)
  const open = await memory.update("first", {
    operation: "question", blocking: false, text: "Should the summary include a short title?",
  })
  assert.equal(open.tasks[0]?.blockingQuestions, 1)
  const optional = await memory.update("first", {
    operation: "question", blocking: false, text: "Which release notes should mention this?",
  })
  assert(optional.task)
  const releaseQuestion = optional.task.questions[2]
  assert(releaseQuestion)
  await memory.update("first", {
    operation: "answer", questionID: releaseQuestion.id, answer: "The next release",
  })
  await memory.update("first", {
    operation: "checkpoint", status: "active", summary: "Design ready; waiting for storage approval",
    done: ["Define task history"], remaining: ["Implement storage"], needsInput: ["Storage location"],
  })

  const resumed = new Memory(storage, projectID)
  await resumed.update("second", { operation: "link", taskID })
  await resumed.update("second", {
    operation: "answer", questionID: blocking.id, answer: "Use the project directory",
  })
  await resumed.update("second", {
    operation: "answer", questionID: blocking.id, answer: "Use the project data directory instead",
  })
  await resumed.update("second", {
    operation: "checkpoint", status: "completed", summary: "Task memory shipped",
    done: ["Define task history", "Implement storage"], remaining: [], needsInput: [],
  })

  const fresh = new Memory(storage, projectID)
  const loaded = await fresh.view("second")
  assert(loaded.task)
  assert.equal(loaded.task.id, taskID)
  assert.deepEqual(loaded.task.sessions, ["first", "second"])
  assert.deepEqual((await fresh.view("first")).task, loaded.task)
  assert.equal(loaded.task.decisions[0]?.id, decision.id)
  assert.equal(loaded.task.decisions[1]?.id, decision.id)
  assert(loaded.task.decisions[2])
  assert.notEqual(loaded.task.decisions[2].id, decision.id)
  assert.deepEqual(loaded.task.decisions.map(({ text, status, reason, sessionID }) => ({
    text, status, reason, sessionID,
  })), [
    { text: "Use a shared file", status: "accepted", reason: "Keep setup simple", sessionID: "first" },
    { text: "Use a shared file", status: "rejected", reason: "Separate projects need separate state", sessionID: "first" },
    { text: "Store state per project", status: "accepted", reason: "Prevent project leaks", sessionID: "first" },
  ])
  assert.deepEqual(latestDecisions(loaded.task).map(({ text, status }) => ({ text, status })), [
    { text: "Use a shared file", status: "rejected" },
    { text: "Store state per project", status: "accepted" },
  ])
  assert.deepEqual(loaded.task.questions.map(({ text, blocking, answers }) => ({
    text, blocking, answers: answers.map(({ text, sessionID }) => ({ text, sessionID })),
  })), [
    {
      text: "Which storage location is approved?", blocking: true,
      answers: [
        { text: "Use the project directory", sessionID: "second" },
        { text: "Use the project data directory instead", sessionID: "second" },
      ],
    },
    { text: "Should the summary include a short title?", blocking: false, answers: [] },
    {
      text: "Which release notes should mention this?", blocking: false,
      answers: [{ text: "The next release", sessionID: "first" }],
    },
  ])
  assert.deepEqual(loaded.task.checkpoints.map(({ at, ...checkpoint }) => checkpoint), [
    {
      sessionID: "first", status: "active", summary: "Design ready; waiting for storage approval",
      done: ["Define task history"], remaining: ["Implement storage"], needsInput: ["Storage location"],
    },
    {
      sessionID: "second", status: "completed", summary: "Task memory shipped",
      done: ["Define task history", "Implement storage"], remaining: [], needsInput: [],
    },
  ])
  assert.equal(loaded.tasks[0]?.status, "completed")
  assert.equal(loaded.tasks[0]?.blockingQuestions, 0)
  const context = taskContext(loaded.task)
  assert.match(context, /Status: completed/)
  assert.match(context, /rejected: Use a shared file/)
  assert.doesNotMatch(context, /accepted: Use a shared file|BLOCKING:/)
  assert.match(context, /Open: Should the summary include a short title/)
  assert.match(context, /Which storage location is approved\?: Use the project data directory instead/)

  const reopened = await fresh.update("second", {
    operation: "question", blocking: true, text: "Approve the next delivery step?",
  })
  assert(reopened.task)
  assert.equal(reopened.tasks[0]?.status, "active")
  assert.equal(reopened.task.checkpoints.at(-1)?.status, "completed")
  assert.match(taskContext(reopened.task), /Status: active/)
  const nextQuestion = reopened.task.questions.at(-1)
  assert(nextQuestion)
  const resolved = await fresh.update("second", {
    operation: "answer", questionID: nextQuestion.id, answer: "The next step is withdrawn",
  })
  assert.equal(resolved.tasks[0]?.status, "completed")

  loaded.task.title = "A caller changed its local copy"
  assert.equal((await fresh.view("second")).task?.title, "Ship task memory")
})

test("bounds automatic context while preserving blocker counts and complete inspection history", async () => {
  const { memory } = fixture()
  const longText = "x".repeat(4000)
  await memory.update("session", { operation: "create", title: longText })
  for (let index = 0; index < 8; index++) {
    await memory.update("session", {
      operation: "decision", status: "accepted", text: longText, reason: longText,
    })
  }
  for (let index = 0; index < 12; index++) {
    await memory.update("session", { operation: "question", blocking: true, text: longText })
  }
  await memory.update("session", {
    operation: "checkpoint", status: "active", summary: longText,
    done: Array.from({ length: 30 }, () => longText),
    remaining: Array.from({ length: 30 }, () => longText),
    needsInput: Array.from({ length: 30 }, () => longText),
  })
  const view = await memory.view("session")
  assert(view.task)
  const context = taskContext(view.task)
  assert(context.length <= 12_000)
  assert.match(context, /Unanswered blocking questions: 12/)
  assert.match(context, /4 more omitted; use task_memory_view/)
  assert.match(context, /Stop work that depends on these answers/)
  assert.equal(view.task.title, longText)
  assert.equal(view.task.decisions.length, 8)
  assert.equal(view.task.decisions[0]?.reason, longText)
  assert.equal(view.task.questions.length, 12)
  assert.equal(view.task.questions[11]?.text, longText)
  assert.equal(view.task.checkpoints[0]?.remaining.length, 30)
  assert.equal(view.task.checkpoints[0]?.remaining[29], longText)
})

test("keeps projects separate and leaves new sessions unlinked", async () => {
  const { memory, storage } = fixture()
  const created = await memory.update("shared-session", { operation: "create", title: "First project" })
  assert(created.task)
  const unlinked = await memory.view("new-session")
  assert.equal(unlinked.task, null)
  assert.deepEqual(unlinked.tasks.map(({ id }) => id), [created.task.id])
  assert.equal((await memory.view("new-session", created.task.id)).task?.id, created.task.id)
  assert.equal((await memory.view("new-session")).task, null)

  const other = new Memory(storage, randomUUID())
  assert.deepEqual(await other.view("shared-session"), { task: null, tasks: [] })
  await assert.rejects(other.view("shared-session", created.task.id), /Task not found in this project/)
  await assert.rejects(other.update("shared-session", {
    operation: "link", taskID: created.task.id,
  }), /Task not found in this project/)
  const second = await other.update("shared-session", { operation: "create", title: "Second project" })
  assert(second.task)
  assert.notEqual(second.task.id, created.task.id)
  assert.deepEqual((await memory.view("shared-session")).tasks.map(({ title }) => title), ["First project"])
  assert.deepEqual((await other.view("shared-session")).tasks.map(({ title }) => title), ["Second project"])
})

test("serializes concurrent updates from separate Memory instances without losing tasks or history", async () => {
  const { memory, projectID, storage } = fixture()
  const other = new Memory(storage, projectID)
  const [first, second] = await Promise.all([
    memory.update("first", { operation: "create", title: "Shared task" }),
    other.update("second", { operation: "create", title: "Independent task" }),
  ])
  assert(first.task)
  assert(second.task)
  const taskID = first.task.id
  await other.update("second", { operation: "link", taskID })
  await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const owner = index % 2 === 0 ? memory : other
    return owner.update(index % 2 === 0 ? "first" : "second", {
      operation: "question", blocking: false, text: `Question ${index}`,
    })
  }))

  const fresh = new Memory(storage, projectID)
  const loaded = await fresh.view("first")
  assert(loaded.task)
  assert.deepEqual(new Set(loaded.tasks.map(({ id }) => id)), new Set([taskID, second.task.id]))
  assert.equal(loaded.task.questions.length, 12)
  assert.deepEqual(new Set(loaded.task.questions.map(({ text }) => text)),
    new Set(Array.from({ length: 12 }, (_, index) => `Question ${index}`)))
  assert.equal(loaded.task.questions.filter(({ sessionID }) => sessionID === "first").length, 6)
  assert.equal(loaded.task.questions.filter(({ sessionID }) => sessionID === "second").length, 6)
  assert.deepEqual((await fresh.view("second")).task, loaded.task)
  assert.equal((await fresh.view("first", second.task.id)).task?.title, "Independent task")
})

for (const obstacle of ["remaining work", "input needed", "unanswered blocking question"] as const) {
  test(`rejects completion with ${obstacle} without changing persisted state`, async () => {
    const { memory, projectID, storage } = fixture()
    await memory.update("session", { operation: "create", title: "Unfinished task" })
    if (obstacle === "unanswered blocking question") {
      await memory.update("session", { operation: "question", blocking: true, text: "Approve deployment?" })
    }
    const before = storage.snapshot()
    await assert.rejects(memory.update("session", {
      operation: "checkpoint", status: "completed", summary: "Premature completion", done: [],
      remaining: obstacle === "remaining work" ? ["Deploy"] : [],
      needsInput: obstacle === "input needed" ? ["Deployment approval"] : [],
    }), /A task cannot be completed while work or blocking input remains/)
    assert.deepEqual(storage.snapshot(), before)
    assert.equal((await new Memory(storage, projectID).view("session")).tasks[0]?.status, "active")
    const recovered = await memory.update("session", {
      operation: "checkpoint", status: "active", summary: "Continue work", done: [],
      remaining: ["Deploy"], needsInput: [],
    })
    assert.equal(recovered.task?.checkpoints.length, 1)
  })
}

test("rejects missing and foreign references without changing persisted state", async () => {
  const { memory, storage } = fixture()
  const target = await memory.update("target", { operation: "create", title: "Target task" })
  assert(target.task)
  await memory.update("foreign", { operation: "create", title: "Other task" })
  const foreign = await memory.update("foreign", {
    operation: "decision", status: "accepted", text: "Foreign choice", reason: "Applies to the other task",
  })
  assert(foreign.task)
  const decision = foreign.task.decisions[0]
  assert(decision)
  const asked = await memory.update("foreign", { operation: "question", blocking: true, text: "Foreign question?" })
  assert(asked.task)
  const question = asked.task.questions[0]
  assert(question)
  const cases: { sessionID: string; change: Change; error: RegExp }[] = [
    { sessionID: "target", change: { operation: "link", taskID: "missing-task" }, error: /Task not found in this project/ },
    { sessionID: "target", change: { operation: "answer", questionID: "missing-question", answer: "Yes" }, error: /Question not found in the linked task/ },
    { sessionID: "target", change: { operation: "answer", questionID: question.id, answer: "Yes" }, error: /Question not found in the linked task/ },
    {
      sessionID: "target", change: {
        operation: "decision", decisionID: "missing-decision", status: "rejected", text: "Unknown choice", reason: "Not approved",
      }, error: /Decision not found in the linked task/,
    },
    {
      sessionID: "target", change: {
        operation: "decision", decisionID: decision.id, status: "rejected", text: "Foreign choice", reason: "Not approved",
      }, error: /Decision not found in the linked task/,
    },
    {
      sessionID: "unlinked", change: { operation: "question", blocking: false, text: "Where does this belong?" },
      error: /Create or link a task before updating it/,
    },
  ]
  const before = storage.snapshot()
  await assert.rejects(memory.view("target", "missing-task"), /Task not found in this project/)
  for (const { sessionID, change, error } of cases) {
    await assert.rejects(memory.update(sessionID, change), error)
    assert.deepEqual(storage.snapshot(), before)
  }
  assert.deepEqual((await memory.view("target")).task, target.task)
  assert.equal((await memory.view("unlinked")).task, null)
})
