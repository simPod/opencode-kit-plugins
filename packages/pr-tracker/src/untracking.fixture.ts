import { mock } from "bun:test"
import { strict as assert } from "node:assert"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { Reference } from "./reference"
import type { Pr } from "./request"

const mode = process.argv[2]
const url = "https://code.example.com/acme/widget/-/merge_requests/42"
const otherURL = "https://code.example.com/acme/widget/-/merge_requests/43"
const pr: Pr = {
  provider: "gitlab", number: 42, url, title: "Tracked change", state: "OPEN", isDraft: false, statusCheckRollup: [],
}
const actual = await import("./request")
let completeFetch: ((value: Pr) => void) | undefined
let fetchStarted: (() => void) | undefined
mock.module("./request", () => ({
  ...actual,
  fetchPr: async (_directory: string, reference?: string | Reference) => {
    if (mode === "in-flight" && reference !== undefined) {
      fetchStarted?.()
      return await new Promise<Pr>((resolve) => { completeFetch = resolve })
    }
    return reference === undefined ? undefined : pr
  },
}))
const { default: plugin } = await import("./index")

type Durable = { roots: Record<string, string[]>; excluded: Record<string, string[]> }
const [durable, setDurable] = createStore<Durable>({ roots: {}, excluded: {} })
if (mode === "remove" || mode === "idempotent") setDurable("roots", "root", [url, otherURL])
if (mode === "family-isolation") {
  setDurable("roots", "root", [url])
  setDurable("roots", "other", [url])
}
if (mode === "remove-recovery") setDurable("roots", "root", [url])
if (mode === "rpc" || mode === "rpc-wrong-location" || mode === "rpc-wrong-family")
  setDurable("roots", "root", [url])

const sessions = [
  { id: "root", location: { directory: "/example/project" }, time: { updated: 1 } },
  { id: "child", parentID: "root", location: { directory: "/example/project" }, time: { updated: 1 } },
  { id: "other", location: { directory: "/example/project" }, time: { updated: 1 } },
]
const [route, setRoute] = createSignal<ReturnType<Plugin.Context["ui"]["router"]["current"]>>(
  { type: "session", sessionID: "child" },
)
type Layer = Parameters<Plugin.Context["keymap"]["layer"]>[0]
type Sidebar = (props: { sessionID: string }) => ReturnType<Parameters<Plugin.Context["ui"]["slot"]>[0]["render"]>
const toasts: Parameters<Plugin.Context["ui"]["toast"]["show"]>[0][] = []
let layer: Layer | undefined
let sidebar: Sidebar | undefined
type ShellEnded = {
  location: { directory: string }
  data: { sessionID: string; shell: { status: string; exit: number; command: string }; output: { output: string } }
}
let shellEnded: ((event: ShellEnded) => void) | undefined
let untrackRequested: ((event: {
  data: { requestID: string; sessionID: string; rootSessionID: string; url: string }
  location: { directory: string }
}) => void) | undefined
const acknowledgements: { requestID: string; rootSessionID: string; removed: boolean }[] = []

const [memory, setMemory] = createStore({ roots: {}, prs: {}, rootIDs: {} })
const context = {
  location: { directory: "/example/project" },
  storage: {
    memory: () => [memory, (mutate: (draft: typeof memory) => void) => setMemory(produce(mutate))],
    store: () => [durable, async (mutate: (draft: Durable) => void) => setDurable(produce(mutate))],
  },
  keymap: { layer: (factory: Layer) => { layer = factory } },
  client: {
    rpc: () => ({
      events: {
        on: (_name: string, callback: typeof untrackRequested) => {
          untrackRequested = callback
          return () => {}
        },
      },
      completeUntrack: async (input: typeof acknowledgements[number]) => {
        acknowledgements.push(input)
        return { accepted: true }
      },
    }),
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (mode === "not-found") throw new Error("Session not found")
        const session = sessions.find((item) => item.id === sessionID)
        assert(session !== undefined)
        return session
      },
      list: async ({ parentID }: { parentID: string }) => ({
        data: sessions.filter((item) => "parentID" in item && item.parentID === parentID), cursor: {},
      }),
    },
    message: {
      list: async ({ sessionID }: { sessionID: string }) => ({
      data: (mode === "remove-recovery" || mode === "in-flight") && sessionID === "child" ? [{
          type: "shell", status: "exited", exit: 0, command: "glab mr create", output: { output: url },
        }] : [],
        cursor: {},
      }),
    },
  },
  data: {
    on: (name: string, callback: (event: ShellEnded) => void) => {
      if (name === "session.shell.ended") shellEnded = callback
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
    slot: (claim: Parameters<Plugin.Context["ui"]["slot"]>[0]) => { sidebar = claim.render as Sidebar },
    toast: { show: (toast: typeof toasts[number]) => toasts.push(toast) },
    dialog: { prompt: async () => undefined },
  },
  theme: { text: { default: "#ffffff", subdued: "#aaaaaa" }, background: { action: { primary: { hovered: "#333333" } } } },
} as unknown as Plugin.Context

let unload = await plugin.setup(context)
assert(layer !== undefined && sidebar !== undefined)
const commands = layer().commands ?? []
const track = commands.find((command) => command.slash?.name === "mr-track")
const untrack = commands.find((command) => command.slash?.name === "mr-untrack")
assert(track !== undefined && untrack !== undefined)
function createView() {
  return testRender(() => sidebar!({ get sessionID() {
  const current = route()
  return current.type === "session" ? current.sessionID : "other"
  } }), { width: 70, height: 8 })
}
let view = await createView()

async function frame() {
  for (let attempt = 0; attempt < 50; attempt++) {
    await Bun.sleep(10)
    await view.renderOnce()
  }
  return view.captureCharFrame()
}
async function restart() {
  view.renderer.destroy()
  if (typeof unload === "function") unload()
  setMemory({ roots: {}, prs: {}, rootIDs: {} })
  unload = await plugin.setup(context)
  view = await createView()
}

try {
  if (mode === "in-flight") {
    const started = new Promise<void>((resolve) => { fetchStarted = resolve })
    assert(shellEnded !== undefined)
    shellEnded({ location: { directory: "/example/child" }, data: {
      sessionID: "child", shell: { status: "exited", exit: 0, command: "glab mr create" }, output: { output: url },
    } })
    await started
    await untrack.run(url)
    completeFetch?.(pr)
    await frame()
    assert.deepEqual(unwrap(durable.roots), { root: [] })
    assert.deepEqual(unwrap(durable.excluded), { root: [url] })
    assert(!view.captureCharFrame().includes("!42"), view.captureCharFrame())
  } else if (mode === "remove-recovery") {
    await frame()
    await untrack.run(url)
    assert.deepEqual(unwrap(durable.roots), { root: [] })
    assert.deepEqual(unwrap(durable.excluded), { root: [url] })
    await restart()
    await frame()
    assert.deepEqual(unwrap(durable.roots), { root: [] })
    assert(!view.captureCharFrame().includes("!42"), "removal must remain in effect after restart and history recovery")
  } else if (mode === "remove" || mode === "idempotent") {
    await frame()
    await untrack.run(`${url}/`)
    if (mode === "idempotent") await untrack.run(url)
    await frame()
    assert.deepEqual(unwrap(durable.roots), { root: [otherURL] })
    assert.deepEqual(unwrap(durable.excluded), { root: [url] })
    assert(!view.captureCharFrame().includes("!42"), view.captureCharFrame())
  } else if (mode === "family-isolation") {
    await untrack.run(url)
    assert.deepEqual(unwrap(durable.roots), { root: [], other: [url] })
    setRoute({ type: "session", sessionID: "other" })
    await frame()
    assert(view.captureCharFrame().includes("!42"))
  } else if (mode === "rpc" || mode === "rpc-wrong-location" || mode === "rpc-wrong-family") {
    assert(untrackRequested !== undefined)
    untrackRequested({
      data: {
        requestID: "request-1", sessionID: "child",
        rootSessionID: mode === "rpc-wrong-family" ? "other-root" : "root",
        url,
      },
      location: { directory: mode === "rpc-wrong-location" ? "/example/other" : "/example/project" },
    })
    await frame()
    assert.deepEqual(unwrap(durable.roots), { root: mode === "rpc" ? [] : [url] })
    assert.deepEqual(unwrap(durable.excluded), mode === "rpc" ? { root: [url] } : {})
    assert.deepEqual(acknowledgements, [{
      requestID: "request-1",
      rootSessionID: mode === "rpc" ? "root" : "",
      removed: mode === "rpc",
    }])
  } else if (mode === "retrack") {
    await untrack.run(url)
    await track.run(url)
    assert.deepEqual(unwrap(durable.roots), { root: [url] })
    assert.deepEqual(unwrap(durable.excluded), { root: [] })
  } else if (mode === "invalid" || mode === "not-found") {
    await untrack.run(mode === "invalid" ? "42" : url)
    assert.deepEqual(unwrap(durable.roots), {})
    assert.deepEqual(unwrap(durable.excluded), {})
    assert.equal(toasts.at(-1)?.variant, "error")
  }
} finally {
  view.renderer.destroy()
  if (typeof unload === "function") unload()
}
