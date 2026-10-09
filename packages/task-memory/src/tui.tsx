import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { createResource, createSignal, For, Show, onCleanup, type Accessor } from "solid-js"
import { currentStatus, latestDecisions } from "./memory.js"
import { TaskMemory } from "./rpc.js"
import type { Change, Task, View } from "./schema.js"

const panelName = "task-memory.overview"

function useTaskView(sessionID: Accessor<string>) {
  const ctx = usePlugin()
  const rpc = ctx.client.rpc(TaskMemory)
  const [revision, setRevision] = createSignal(0)
  const [view] = createResource(
    () => ({ sessionID: sessionID(), revision: revision(), location: ctx.data.session.get(sessionID())?.location }),
    async ({ sessionID, location }): Promise<{ view?: View; error?: string }> => {
      try {
        if (!location) throw new Error("Session information is still loading.")
        return { view: await rpc.read({ sessionID }, { location }) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
  )
  const stop = rpc.events.on("updated", (event) => {
    if (event.data.projectID === ctx.data.session.get(sessionID())?.projectID) setRevision((value) => value + 1)
  })
  onCleanup(stop)
  return view
}

function TaskPanel(props: { panel: PanelInput }) {
  const ctx = usePlugin()
  const view = useTaskView(() => props.panel.sessionID)
  const [history, setHistory] = createSignal(false)
  ctx.keymap.layer(() => ({
    commands: [
      { id: "task-memory.history", title: "Toggle task history", bind: "h", run: () => { setHistory(!history()) } },
      { id: "task-memory.close", title: "Close task memory", bind: "escape", run: props.panel.close },
      { id: "task-memory.fullscreen", title: "Toggle task memory fullscreen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  const task = () => view()?.view?.task
  const checkpoint = () => task()?.checkpoints.at(-1)
  const unanswered = () => task()?.questions.filter((question) => question.answers.length === 0) ?? []

  return (
    <scrollbox flexGrow={1} padding={1}>
      <box flexDirection="column" gap={1}>
        <text fg={ctx.theme.text.base}><b>Task memory</b> · h: history · f: fullscreen · esc: close</text>
        <Show when={view()?.error}>
          <text fg={ctx.theme.text.feedback.error.base}>Cannot load task memory: {view()?.error}</text>
        </Show>
        <Show when={view.loading}><text fg={ctx.theme.text.muted}>Loading…</text></Show>
        <Show when={task()} fallback={
          <box flexDirection="column" gap={1}>
            <text>No task linked to this session.</text>
            <text fg={ctx.theme.text.muted}>Use /task-memory-new or /task-memory-link.</text>
          </box>
        }>
          {(current: Accessor<Task>) => <>
            <text fg={ctx.theme.text.base}><b>{current().title}</b></text>
            <text fg={ctx.theme.text.muted}>{current().id}</text>
            <text>Status: {currentStatus(current())}</text>
            <Show when={unanswered().some((question) => question.blocking)}>
              <text fg={ctx.theme.text.feedback.warning.base}><b>YOUR INPUT NEEDED — blocking questions remain</b></text>
            </Show>
            <text><b>Questions</b></text>
            <For each={unanswered()} fallback={<text fg={ctx.theme.text.muted}>No unanswered questions.</text>}>
              {(question) => <text fg={question.blocking ? ctx.theme.text.feedback.warning.base : ctx.theme.text.base}>
                {question.blocking ? "BLOCKING" : "OPEN"}: {question.text}
              </text>}
            </For>
            <text><b>Last checkpoint</b> · {checkpoint()?.status ?? "active"}</text>
            <text>{checkpoint()?.summary ?? "No checkpoint recorded."}</text>
            <Show when={checkpoint()}>{(saved: Accessor<Task["checkpoints"][number]>) => <>
              <text fg={ctx.theme.text.muted}>Saved {saved().at}</text>
              <text><b>Done</b></text>
              <For each={saved().done} fallback={<text fg={ctx.theme.text.muted}>None recorded.</text>}>
                {(item) => <text>✓ {item}</text>}
              </For>
              <text><b>Remaining</b></text>
              <For each={saved().remaining} fallback={<text fg={ctx.theme.text.muted}>None recorded.</text>}>
                {(item) => <text>· {item}</text>}
              </For>
              <text><b>Needs input</b></text>
              <For each={saved().needsInput} fallback={<text fg={ctx.theme.text.muted}>None recorded.</text>}>
                {(item) => <text fg={ctx.theme.text.feedback.warning.base}>? {item}</text>}
              </For>
            </>}</Show>
            <text><b>Decisions</b></text>
            <For each={latestDecisions(current())} fallback={<text fg={ctx.theme.text.muted}>No decisions recorded.</text>}>
              {(decision) => <box flexDirection="column">
                <text>{decision.status.toUpperCase()}: {decision.text}</text>
                <text fg={ctx.theme.text.muted}>Reason: {decision.reason}</text>
              </box>}
            </For>
            <Show when={history()}>
              <text><b>History</b></text>
              <For each={current().decisions}>{(decision) =>
                <text fg={ctx.theme.text.muted}>{decision.at} · {decision.status}: {decision.text} · {decision.reason}</text>
              }</For>
              <For each={current().questions.filter((question) => question.answers.length > 0)}>{(question) =>
                <box flexDirection="column">
                  <text>{question.text}</text>
                  <For each={question.answers}>{(answer) =>
                    <text fg={ctx.theme.text.muted}>{answer.at} · {answer.text}</text>
                  }</For>
                </box>
              }</For>
              <For each={current().checkpoints}>{(saved) => <box flexDirection="column">
                <text fg={ctx.theme.text.muted}>{saved.at} · {saved.status}: {saved.summary}</text>
                <text>Done: {saved.done.join("; ") || "None"}</text>
                <text>Remaining: {saved.remaining.join("; ") || "None"}</text>
                <text>Needs input: {saved.needsInput.join("; ") || "None"}</text>
              </box>}</For>
              <text fg={ctx.theme.text.muted}>Linked sessions: {current().sessions.join(", ")}</text>
            </Show>
            <text fg={ctx.theme.text.muted}>
              Commands: /task-memory-decision · /task-memory-question · /task-memory-answer · /task-memory-checkpoint
            </text>
          </>}
        </Show>
      </box>
    </scrollbox>
  )
}

function TaskStatus(props: { sessionID: string }) {
  const ctx = usePlugin()
  const view = useTaskView(() => props.sessionID)
  const task = () => view()?.view?.task
  const blocking = () => task()?.questions.filter((question) => question.blocking && question.answers.length === 0) ?? []
  return <Show when={task()}>{(current: Accessor<Task>) =>
    <box flexDirection="column" paddingLeft={1}>
      <text fg={ctx.theme.text.muted}>Task: {current().title} · /task-memory</text>
      <For each={blocking()}>{(question) =>
        <text fg={ctx.theme.text.feedback.warning.base}>YOUR INPUT NEEDED: {question.text}</text>
      }</For>
    </box>
  }</Show>
}

export default Plugin.define({
  id: "task-memory.tui",
  setup(ctx) {
    const rpc = ctx.client.rpc(TaskMemory)
    const location = (id: string) => {
      const session = ctx.data.session.get(id)
      if (!session) throw new Error("Session information is still loading.")
      return session.location
    }
    const sessionID = () => {
      const route = ctx.ui.router.current()
      if (route.type !== "session") throw new Error("Open a session first.")
      return route.sessionID
    }
    const show = () => ctx.ui.panel.open(panelName)
    const prompt = async (title: string, placeholder?: string) => {
      const value = await ctx.ui.dialog.prompt({ title, placeholder })
      return value?.trim() || undefined
    }
    const save = async (id: string, change: Change) => {
      await rpc.update({ sessionID: id, change }, { location: location(id) })
      ctx.ui.toast.show({ message: "Task memory saved", variant: "success" })
      show()
    }
    const linked = async (id: string): Promise<Task> => {
      const view = await rpc.read({ sessionID: id }, { location: location(id) })
      if (!view.task) throw new Error("Use /task-memory-new or /task-memory-link first.")
      return view.task
    }
    const actions: Array<{ name: string; title: string; run: () => Promise<void> | void }> = [
      { name: "task-memory", title: "Open task memory", run: () => { show() } },
      {
        name: "task-memory-new", title: "Create a task",
        run: async () => {
          const id = sessionID()
          const title = await prompt("Task title")
          if (title) await save(id, { operation: "create", title })
        },
      },
      {
        name: "task-memory-link", title: "Link this session to a task",
        run: async () => {
          const id = sessionID()
          const view = await rpc.read({ sessionID: id }, { location: location(id) })
          const taskID = await ctx.ui.dialog.select({
            title: "Link a task in this project",
            options: view.tasks.map((task) => ({ title: task.title, value: task.id,
              description: `${task.status} · ${task.blockingQuestions} blocking · ${task.id}` })),
          })
          if (taskID) await save(id, { operation: "link", taskID })
        },
      },
      {
        name: "task-memory-decision", title: "Record or correct a decision",
        run: async () => {
          const id = sessionID()
          const task = await linked(id)
          const selected = await ctx.ui.dialog.select({ title: "Decision", options: [
            { title: "Record a new decision", value: "new" },
            ...latestDecisions(task).map((decision) => ({ title: decision.text, value: decision.id,
              description: `Correct this ${decision.status} decision` })),
          ] })
          if (!selected) return
          const status = await ctx.ui.dialog.select({ title: "Decision status", options: [
            { title: "Accepted", value: "accepted" as const }, { title: "Rejected", value: "rejected" as const },
          ] })
          if (!status) return
          const text = await prompt("Decision or alternative")
          if (!text) return
          const reason = await prompt("Reason and basis for the decision")
          if (!reason) return
          await save(id, { operation: "decision", status, text, reason,
            ...(selected === "new" ? {} : { decisionID: selected }) })
        },
      },
      {
        name: "task-memory-question", title: "Record a pending question",
        run: async () => {
          const id = sessionID()
          await linked(id)
          const text = await prompt("Question")
          if (!text) return
          const blocking = await ctx.ui.dialog.select({ title: "Does this question block work?", options: [
            { title: "Blocking — answer required", value: "yes" }, { title: "Not blocking", value: "no" },
          ] })
          if (blocking) await save(id, { operation: "question", blocking: blocking === "yes", text })
        },
      },
      {
        name: "task-memory-answer", title: "Answer or correct a question",
        run: async () => {
          const id = sessionID()
          const task = await linked(id)
          const questionID = await ctx.ui.dialog.select({ title: "Question", options: task.questions.map((question) => ({
            title: question.text, value: question.id,
            description: question.answers.length > 0 ? "Correct the recorded answer" : question.blocking ? "Blocking" : "Open",
          })) })
          if (!questionID) return
          const answer = await prompt("Answer (or explain why the question is withdrawn)")
          if (answer) await save(id, { operation: "answer", answer, questionID })
        },
      },
      {
        name: "task-memory-checkpoint", title: "Save a task checkpoint",
        run: async () => {
          const id = sessionID()
          await linked(id)
          const summary = await prompt("Checkpoint summary")
          if (!summary) return
          const lists: Record<"done" | "remaining" | "needsInput", string[]> = { done: [], remaining: [], needsInput: [] }
          for (const [key, title] of [
            ["done", "Completed work"], ["remaining", "Remaining work"], ["needsInput", "Needs your input"],
          ] as const) {
            const value = await ctx.ui.dialog.prompt({ title, placeholder: "Separate items with ; — leave empty for none" })
            if (value === undefined) return
            lists[key] = value.split(";").map((item) => item.trim()).filter(Boolean)
          }
          const status = await ctx.ui.dialog.select({ title: "Task status", options: [
            { title: "Active", value: "active" as const }, { title: "Completed", value: "completed" as const },
          ] })
          if (status) await save(id, { operation: "checkpoint", summary, status, ...lists })
        },
      },
    ]

    ctx.keymap.layer(() => ({ mode: "global", commands: actions.map((action) => ({
      id: `task-memory.${action.name}`, title: action.title, group: "Task memory", palette: true,
      slash: { name: action.name }, enabled: () => ctx.ui.router.current().type === "session",
      run: async () => {
        try { await action.run() } catch (error) {
          ctx.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" })
        }
      },
    })) }))
    const panel = ctx.ui.slot({ append: "session.panel", render: (panel) => (
      <Show when={panel.name === panelName}><TaskPanel panel={panel} /></Show>
    ) })
    const status = ctx.ui.slot({ append: "session.composer.top", render: (input) => <TaskStatus sessionID={input.sessionID} /> })
    return () => { panel(); status() }
  },
})
