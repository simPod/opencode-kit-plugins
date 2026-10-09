import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/index.ts", "src/tui.tsx", "src/rpc.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  plugins: [createSolidTransformPlugin()],
  external: [
    "@opencode/plugin", "@opencode/plugin/*", "@opentui/core", "@opentui/core/*",
    "@opentui/core-*", "@opentui/keymap", "@opentui/solid", "@opentui/solid/*", "solid-js", "solid-js/*",
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
await Bun.write("dist/package.json", JSON.stringify({
  name: "@simpod/opencode-task-memory",
  type: "module",
  exports: { ".": "./index.js", "./tui": "./tui.js", "./rpc": "./rpc.js" },
}, null, 2) + "\n")
