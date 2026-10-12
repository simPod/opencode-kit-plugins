import { mock } from "bun:test"
import { strict as assert } from "node:assert"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { Reference } from "./reference"
import type { Pr } from "./request"

const mode = process.argv[2]
const pr: Pr = {
  provider: "gitlab", number: 42, url: "https://code.example.com/acme/widget/-/merge_requests/42",
  title: "Explicitly tracked change", state: mode === "closed" ? "MERGED" : "OPEN",
  isDraft: false, statusCheckRollup: [],
}
const branchPr: Pr = { ...pr, number: 23034, url: pr.url.replace(/42$/, "23034"), title: "Unrelated checkout branch" }
const lookups: string[] = []
const actual = await import("./request")
mock.module("./request", () => {
  return {
    ...actual,
    fetchPr: async (directory: string, reference?: string | Reference) => {
      if (reference === undefined) return mode === "unrelated-branch" ? branchPr : undefined
      lookups.push(directory)
      return mode === "lookup" ? undefined : pr
    },
  }
})
const { default: plugin } = await import("./index")
type Durable = { roots: Record<string, string[]> }
const [durable, setDurable] = createStore<Durable>({ roots: {} })
const sessions = [
  { id: "root", location: { directory: "/example/parent" }, time: { updated: 1 } },
  { id: "child", parentID: "root", location: { directory: "/example/active-worktree" }, time: { updated: 1 } },
  { id: "other", location: { directory: "/example/active-worktree" }, time: { updated: 1 } },
]
const [route, setRoute] = createSignal<ReturnType<Plugin.Context["ui"]["router"]["current"]>>(
  mode === "home" ? { type: "home" } : { type: "session", sessionID: "child" },
)
type Sidebar = (props: { sessionID: string }) => ReturnType<Parameters<Plugin.Context["ui"]["slot"]>[0]["render"]>
type Layer = Parameters<Plugin.Context["keymap"]["layer"]>[0]
const toasts: Parameters<Plugin.Context["ui"]["toast"]["show"]>[0][] = []
let sidebar: Sidebar | undefined
let layer: Layer | undefined
let saves = 0
let historyAvailable = true
type ShellEnded = {
  location: { directory: string }
  data: { sessionID: string; shell: { status: string; exit: number; command: string }; output: { output: string } }
}
let shellEnded: ((event: ShellEnded) => void) | undefined

async function start() {
  const [memory, setMemory] = createStore({ roots: {}, prs: {}, rootIDs: {} })
  const context = {
    location: { directory: "/example/launch" },
    storage: {
      memory: () => [memory, (mutate: (draft: typeof memory) => void) => setMemory(produce(mutate))],
      store: () => [durable, async (mutate: (draft: Durable) => void) => {
        if (mode === "save" || mode === "automatic-save") throw new Error("Disk unavailable")
        setDurable(produce(mutate))
        saves++
      }],
    },
    keymap: { layer: (factory: Layer) => { layer = factory } },
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => {
          const session = sessions.find((item) => item.id === sessionID)
          assert(session !== undefined)
          return session
        },
        list: async ({ parentID }: { parentID: string }) => ({
          data: sessions.filter((item) => "parentID" in item && item.parentID === parentID), cursor: {},
        }),
      },
      message: { list: async ({ sessionID }: { sessionID: string }) => {
        if (!historyAvailable) throw new Error("History unavailable after restart")
        return { data: mode === "recovered" && sessionID === "child" ? [{
          type: "shell", status: "exited", exit: 0, command: "glab mr create", output: { output: pr.url },
        }] : [], cursor: {} }
      } },
    },
    data: {
      on: (name: string, run: (event: ShellEnded) => void) => {
        if (name === "session.shell.ended") shellEnded = run
        return () => {}
      },
      session: {
        root: (id: string) => id === "child" ? "root" : id,
        get: (id: string) => sessions.find((session) => session.id === id),
        message: { get: () => undefined },
      },
    },
    ui: {
      router: { current: route },
      slot: (claim: Parameters<Plugin.Context["ui"]["slot"]>[0]) => {
        assert(claim.append === "sidebar.content")
        sidebar = claim.render
      },
      toast: { show: (toast: typeof toasts[number]) => toasts.push(toast) },
      dialog: { prompt: async () => undefined },
    },
    theme: { text: { default: "#ffffff", subdued: "#aaaaaa" }, background: { action: { primary: { hovered: "#333333" } } } },
  } as unknown as Plugin.Context
  const unload = await plugin.setup(context)
  assert(sidebar !== undefined)
  assert(layer !== undefined, "register the explicit MR tracking command")
  const command = layer().commands?.find((item) => item.slash?.name === "mr-track")
  assert(command !== undefined, "register the explicit MR tracking command")
  const render = sidebar
  const view = await testRender(() => render({ get sessionID() {
    const current = route()
    return current.type === "session" ? current.sessionID : "other"
  } }), { width: 70, height: 8 })
  return { command, view, unload }
}

let active = await start()
async function frame() {
  for (let attempt = 0; attempt < 50; attempt++) {
    await Bun.sleep(10)
    await active.view.renderOnce()
    if (active.view.captureCharFrame().includes("!42")) break
  }
  return active.view.captureCharFrame()
}
function stop() {
  active.view.renderer.destroy()
  if (typeof active.unload === "function") active.unload()
}
try {
  const initial = await frame()
  assert.equal(initial.includes("!42"), mode === "recovered")
  assert(!initial.includes("!23034"), "do not show the checkout branch MR without a link to this session family")
  if (mode === "automatic" || mode === "automatic-save") {
    assert(shellEnded !== undefined)
    shellEnded({ location: { directory: "/example/active-worktree" }, data: {
      sessionID: "child", shell: { status: "exited", exit: 0, command: "glab mr create" }, output: { output: pr.url },
    } })
    assert((await frame()).includes("!42"), "display an MR adopted from a live shell event")
  } else if (mode === "invalid") {
    for (const input of ["42", "https://github.com/acme/widget/pull/42", "https://user:secret@code.example.com/acme/widget/-/merge_requests/42"])
      await active.command.run(input)
    assert.equal(lookups.length, 0)
  } else if (mode !== "recovered") {
    await active.command.run(`  ${pr.url}  `)
  }
  if (mode === "automatic-save") {
    assert.deepEqual(unwrap(durable.roots), {})
    assert((await frame()).includes("!42"), "keep the current row when saving fails")
    assert.equal(toasts.at(-1)?.variant, "error", "report that automatic tracking could not be saved")
  } else if (["invalid", "lookup", "save", "home"].includes(mode ?? "")) {
    assert.equal(saves, 0)
    assert.deepEqual(unwrap(durable.roots), {})
    assert(!(await frame()).includes("!42"))
    assert.equal(toasts.at(-1)?.variant, "error")
  } else {
    assert.deepEqual(unwrap(durable.roots), { root: [pr.url] })
    if (mode === "track" || mode === "closed")
      assert(lookups.every((directory) => directory === "/example/active-worktree"))
    if (mode === "closed") {
      assert(!(await frame()).includes("!42"))
      assert.match(toasts.at(-1)?.message ?? "", /hidden/)
    } else {
      assert.equal((await frame()).match(/!42/g)?.length, 1)
      if (mode === "track") {
        await active.command.run(pr.url)
        assert.deepEqual(unwrap(durable.roots), { root: [pr.url] })
      }
      setRoute({ type: "session", sessionID: "other" })
      const unrelated = await frame()
      assert(!unrelated.includes("!42"), "do not attach an MR to unrelated sessions sharing the same checkout")
      assert(!unrelated.includes("!23034"), "do not discover the shared checkout branch for an unrelated session")
      stop()
      setRoute({ type: "session", sessionID: "child" })
      historyAvailable = false
      active = await start()
      assert.equal((await frame()).match(/!42/g)?.length, 1, "restore the saved link with empty runtime state and unavailable history after restart")
    }
  }
} finally {
  stop()
}
