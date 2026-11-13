import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { rm } from "node:fs/promises"
import path from "node:path"

const directory = path.resolve(process.argv[2] ?? ".")
await rm(path.join(directory, "dist"), { recursive: true, force: true })
const tsx = path.join(directory, "src/index.tsx")
const entrypoints = [(await Bun.file(tsx).exists()) ? tsx : path.join(directory, "src/index.ts")]
for (const entry of ["server.ts", "rpc.ts"]) {
  const file = path.join(directory, "src", entry)
  if (await Bun.file(file).exists()) entrypoints.push(file)
}
const result = await Bun.build({
  entrypoints,
  outdir: path.join(directory, "dist"),
  target: "bun",
  format: "esm",
  plugins: [createSolidTransformPlugin()],
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/*",
    "@opencode/plugin",
    "@opencode/plugin/*",
    "@opentui/core",
    "@opentui/core/*",
    "@opentui/core-*",
    "@opentui/keymap",
    "@opentui/solid",
    "@opentui/solid/*",
    "solid-js",
    "solid-js/*",
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
