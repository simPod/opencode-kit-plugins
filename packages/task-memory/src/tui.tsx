import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { createResource, createSignal, For, Show, onCleanup, type Accessor } from "solid-js"
import { currentStatus, latestDecisions, latestFindings } from "./memory.js"
import { TaskMemory } from "./rpc.js"
import type { Change, Finding, FindingScope, Task, View } from "./schema.js"

const panelName = "task-memory.overview"
const projectPanelName = "task-memory.project"
const findingLabel = (kind: Finding["kind"]) => kind === "verification" ? "NOT VERIFIED" : kind.toUpperCase()

function FindingRecord(props: { finding: Finding; origin: Finding }) {
  const ctx = usePlugin()
  return <box flexDirection="column">
    <text fg={props.finding.status === "open" ? ctx.theme.text.feedback.warning.base : ctx.theme.text.base} wrapMode="word">
      <b>{findingLabel(props.finding.kind)} · {props.finding.status.toUpperCase()}</b>: {props.finding.text}
    </text>
    <text fg={ctx.theme.text.base} wrapMode="word">Evidence / reason: {props.finding.reason}</text>
    <text fg={ctx.theme.text.muted} wrapMode="word">
      Origin: {props.origin.at} · session {props.origin.sessionID} · {props.finding.taskID ? `task ${props.finding.taskID}` : "no linked task"}
    </text>
    <text fg={ctx.theme.text.muted} wrapMode="word">
      Updated: {props.finding.at} · session {props.finding.sessionID} · {props.finding.id}
    </text>
  </box>
}

function useTaskView(sessionID: Accessor<string>, scope: Accessor<FindingScope> = () => "current") {
  const ctx = usePlugin()
  const rpc = ctx.client.rpc(TaskMemory)
  const [revision, setRevision] = createSignal(0)
  const [view] = createResource(
    () => ({
      sessionID: sessionID(), scope: scope(), revision: revision(), location: ctx.data.session.get(sessionID())?.location,
      projectID: ctx.data.session.get(sessionID())?.projectID,
    }),
    async ({ sessionID, scope, location, projectID }): Promise<{
      sessionID: string; scope: FindingScope; directory?: string; projectID?: string; view?: View; error?: string
    }> => {
      const identity = { sessionID, scope, directory: location?.directory, projectID }
      try {
        if (!location) throw new Error("Session information is still loading.")
        return { ...identity, view: await rpc.read({ sessionID, scope }, { location }) }
      } catch (error) {
        return { ...identity, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )
  const stop = rpc.events.on("updated", (event) => {
    if (event.data.projectID === ctx.data.session.get(sessionID())?.projectID) setRevision((value) => value + 1)
  })
  onCleanup(stop)
  return {
    loading: () => view.loading,
    view: () => {
      const result = view()
      const current = ctx.data.session.get(sessionID())
      if (result?.sessionID !== sessionID() || result.scope !== scope() || result.directory !== current?.location.directory ||
        result.projectID !== current?.projectID) return undefined
      return result
    },
  }
}

function TaskPanel(props: { panel: PanelInput }) {
  const ctx = usePlugin()
  const scope = (): FindingScope => props.panel.name === projectPanelName ? "project" : "current"
  const scopeLabel = () => scope() === "project" ? "All project findings" : "Current task/session"
  const emptyScope = () => scope() === "project" ? "in this project" : "for the current task/session"
  const { view, loading } = useTaskView(() => props.panel.sessionID, scope)
  const [history, setHistory] = createSignal(false)
  ctx.keymap.layer(() => ({
    commands: [
      { id: "task-memory.scope", title: scope() === "project" ? "Show current task/session findings" : "Show all project findings", bind: "p",
        run: () => { ctx.ui.panel.open(scope() === "project" ? panelName : projectPanelName) } },
      { id: "task-memory.history", title: "Toggle findings and task history", bind: "h", run: () => { setHistory(!history()) } },
      { id: "task-memory.close", title: "Close task memory", bind: "escape", run: props.panel.close },
      { id: "task-memory.fullscreen", title: "Toggle task memory fullscreen", bind: "f", run: props.panel.toggleFullscreen },
    ],
  }))
  const task = () => view()?.view?.task
  const checkpoint = () => task()?.checkpoints.at(-1)
  const unanswered = () => task()?.questions.filter((question) => question.answers.length === 0) ?? []
  const findings = () => latestFindings(view()?.view?.findings ?? [])
  const origin = (finding: Finding) => view()?.view?.findings.find((entry) => entry.id === finding.id) ?? finding

  return (
    <scrollbox flexGrow={1} padding={1}>
      <box flexDirection="column" gap={1}>
        <text fg={ctx.theme.text.base} wrapMode="word"><b>Task memory · {scopeLabel()}</b> · p: {scope() === "project" ? "current task/session" : "all project findings"} · h: history · f: fullscreen · esc: close</text>
        <Show when={view()?.error}>
          <text fg={ctx.theme.text.feedback.error.base}>Cannot load task memory: {view()?.error}</text>
        </Show>
        <Show when={loading()}><text fg={ctx.theme.text.muted}>Loading…</text></Show>
        <Show when={view()?.view && !view()?.error}>
          <text fg={ctx.theme.text.base}><b>{scopeLabel()}</b></text>
          <text fg={ctx.theme.text.muted} wrapMode="word">{scope() === "project"
            ? "Findings from all tasks and sessions in this project."
            : "Findings first recorded in this session or linked task. Other project findings are not shown."}</text>
          <text fg={ctx.theme.text.muted} wrapMode="word">Records are not permission to fix them. Missing verification is not proof of a bug.</text>
          <text><b>Open findings</b> · {findings().filter((finding) => finding.status === "open").length}</text>
          <For each={findings().filter((finding) => finding.status === "open")} fallback={
            <text fg={ctx.theme.text.muted}>No open findings recorded {emptyScope()}.</text>
          }>{(finding) => <FindingRecord finding={finding} origin={origin(finding)} />}</For>
          <text><b>Explicitly deferred</b> · {findings().filter((finding) => finding.status === "deferred").length}</text>
          <For each={findings().filter((finding) => finding.status === "deferred")} fallback={
            <text fg={ctx.theme.text.muted}>No deferred findings recorded {emptyScope()}.</text>
          }>{(finding) => <FindingRecord finding={finding} origin={origin(finding)} />}</For>
          <text fg={ctx.theme.text.muted}>/task-memory-finding · record, edit, resolve, defer, or reopen</text>
          <Show when={history()}>
            <text><b>Finding history</b> · all revisions, including resolved findings</text>
            <For each={[...(view()?.view?.findings ?? [])].reverse()} fallback={<text fg={ctx.theme.text.muted}>No finding history recorded {emptyScope()}.</text>}>
              {(finding) => <FindingRecord finding={finding} origin={origin(finding)} />}
            </For>
          </Show>
        </Show>
        <Show when={task()} fallback={
          <Show when={view()?.view && !view()?.error}>
            <box flexDirection="column" gap={1}>
              <text>No task linked to this session.</text>
              <text fg={ctx.theme.text.muted}>Use /task-memory-new or /task-memory-link.</text>
            </box>
          </Show>
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
              <text><b>Task history</b></text>
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
  const { view } = useTaskView(() => props.sessionID)
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

function TaskSidebar(props: { sessionID: string }) {
  const ctx = usePlugin()
  const { view, loading } = useTaskView(() => props.sessionID)
  const short = (text: string, limit = 160) => text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
  const findings = () => latestFindings(view()?.view?.findings ?? [])
  const open = () => findings().filter((finding) => finding.status === "open")
  const deferred = () => findings().filter((finding) => finding.status === "deferred")

  return <box flexDirection="column" gap={1} paddingBottom={1}>
    <text fg={ctx.theme.text.base}><b>Open findings</b> · current task/session</text>
    <Show when={loading() && !view()?.view}><text fg={ctx.theme.text.muted}>Loading…</text></Show>
    <Show when={view()?.error}>
      <text fg={ctx.theme.text.feedback.error.base} wrapMode="word">Unavailable: {short(view()?.error ?? "")}</text>
    </Show>
    <Show when={view()?.view && !view()?.error}>
      <For each={open().slice(0, 6)} fallback={<text fg={ctx.theme.text.muted}>No open findings for the current task/session.</text>}>
        {(finding) => <box flexDirection="column">
          <text fg={finding.kind === "bug" ? ctx.theme.text.feedback.error.base : ctx.theme.text.feedback.warning.base}>
            <b>{findingLabel(finding.kind)}</b>
          </text>
          <text fg={ctx.theme.text.base} wrapMode="word">{short(finding.text)}</text>
        </box>}
      </For>
      <Show when={open().length > 6}>
        <text fg={ctx.theme.text.muted}>+ {open().length - 6} more open findings</text>
      </Show>
      <text fg={ctx.theme.text.muted}>{open().length} open · {deferred().length} deferred</text>
    </Show>
    <text fg={ctx.theme.text.muted}>/task-memory · full record</text>
  </box>
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
    const show = (scope: FindingScope = "current") => ctx.ui.panel.open(scope === "project" ? projectPanelName : panelName)
    const prompt = async (title: string, placeholder?: string) => {
      const value = await ctx.ui.dialog.prompt({ title, placeholder })
      return value?.trim() || undefined
    }
    const save = async (id: string, change: Change, scope: FindingScope = "current") => {
      await rpc.update({ sessionID: id, change }, { location: location(id) })
      ctx.ui.toast.show({ message: "Task memory saved", variant: "success" })
      show(scope)
    }
    const linked = async (id: string): Promise<Task> => {
      const view = await rpc.read({ sessionID: id }, { location: location(id) })
      if (!view.task) throw new Error("Use /task-memory-new or /task-memory-link first.")
      return view.task
    }
    const actions: Array<{ name: string; title: string; run: () => Promise<void> | void }> = [
      { name: "task-memory", title: "Open task memory", run: () => { show() } },
      { name: "task-memory-project", title: "Open all project findings", run: () => { show("project") } },
      {
        name: "task-memory-finding", title: "Record or update a project finding",
        run: async () => {
          const id = sessionID()
          let scope: FindingScope = "current"
          let view = await rpc.read({ sessionID: id, scope }, { location: location(id) })
          const pick = () => ctx.ui.dialog.select({ title: scope === "project" ? "All project findings" : "Current task/session findings", options: [
            ...latestFindings(view.findings).map((finding) => ({ title: `${findingLabel(finding.kind)} · ${finding.status}: ${finding.text}`,
              value: finding.id, description: `Evidence / reason: ${finding.reason}` })),
            ...(scope === "current" ? [{ title: "Inspect all project findings", value: "project", description: "Include findings from other tasks and sessions before adding a new one" }] : []),
            { title: "Record a new open finding", value: "new", description: "Bug, risk, or missing verification — no linked task required" },
          ] })
          let selected = await pick()
          if (selected === "project") {
            scope = "project"
            view = await rpc.read({ sessionID: id, scope }, { location: location(id) })
            selected = await pick()
          }
          if (!selected) return
          const existing = latestFindings(view.findings).find((finding) => finding.id === selected)
          const action = existing ? await ctx.ui.dialog.select({ title: "Update this finding", options: [
            { title: "Change status only", value: "status", description: "Keep the existing kind and text" },
            { title: "Edit kind, text, or evidence", value: "edit", description: "Keep the current status" },
          ] }) : "edit"
          if (!action) return
          let kind = existing?.kind
          let text = existing?.text
          let reason = existing?.reason
          let status: Finding["status"] = existing?.status ?? "open"
          if (action === "status") {
            const next = await ctx.ui.dialog.select({ title: `Finding status · currently ${status}`, options: [
              { title: "Open / reopen", value: "open" as const, description: "Keep this follow-up open in its original task/session" },
              { title: "Resolve", value: "resolved" as const, description: "Requires evidence that the issue or verification gap is closed" },
              { title: "Defer", value: "deferred" as const, description: "Requires a reason and explicit approval; this does not resolve the finding" },
            ] })
            if (!next) return
            status = next
          } else {
            const next = await ctx.ui.dialog.select({ title: "Finding kind", options: [
              { title: "Bug", value: "bug" as const, description: "Observed incorrect behavior" },
              { title: "Risk", value: "risk" as const, description: "A potential problem that still needs attention" },
              { title: "Not verified", value: "verification" as const, description: "Missing verification — not proof of a bug" },
            ] })
            if (!next) return
            kind = next
            const value = await ctx.ui.dialog.prompt({ title: existing ? "Finding text — leave empty to keep it" : "Actionable finding or verification gap",
              placeholder: existing?.text })
            if (value === undefined) return
            text = value.trim() || existing?.text
            if (!text) return
          }
          if (action === "status" || action === "edit") {
            const title = status === "resolved"
              ? "Evidence that closes this finding (verification gaps require actual verification)"
              : status === "deferred" ? "Reason and explicit approval to defer this finding"
                : action === "status" ? "Evidence / reason for opening or reopening this finding"
                  : existing ? "Evidence / reason — leave empty to keep it" : "Evidence / reason (state what is not verified)"
            const value = await ctx.ui.dialog.prompt({ title, placeholder: existing?.reason })
            if (value === undefined) return
            reason = value.trim() || (action === "edit" && status === "open" ? existing?.reason : undefined)
            if (!reason) return
          }
          if (!kind || !text || !reason) return
          if (status !== "open") {
            const confirmed = await ctx.ui.dialog.select({ title: status === "resolved" ? "Approve resolution with the recorded evidence?" : "Explicitly approve deferral?", options: [
              { title: "Cancel — keep the current finding", value: "cancel" },
              { title: status === "resolved" ? "Approve resolution" : "Approve deferral", value: "approve",
                description: status === "resolved" ? "Remove from open findings; retain the full history" : "Keep as deferred; this is not resolved" },
            ] })
            if (confirmed !== "approve") return
          }
          await save(id, { operation: "finding", kind, status, text, reason,
            ...(existing ? { findingID: existing.id, expectedRevision: view.findings.filter((finding) => finding.id === existing.id).length } : {}) }, scope)
        },
      },
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
      <Show when={panel.name === panelName || panel.name === projectPanelName}><TaskPanel panel={panel} /></Show>
    ) })
    const status = ctx.ui.slot({ append: "session.composer.top", render: (input) => <TaskStatus sessionID={input.sessionID} /> })
    const sidebar = ctx.ui.slot({ prepend: "sidebar.content", render: (input) => <TaskSidebar sessionID={input.sessionID} /> })
    return () => { panel(); status(); sidebar() }
  },
})
