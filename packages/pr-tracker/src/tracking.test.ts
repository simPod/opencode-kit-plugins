import { test } from "bun:test"
import { strict as assert } from "node:assert"
import path from "node:path"

for (const mode of ["track", "unrelated-branch", "automatic", "recovered", "automatic-save", "invalid", "lookup", "save", "home", "closed"]) {
  test(`session MR tracking: ${mode}`, async () => {
    const proc = Bun.spawn([
      process.execPath, "--preload", "@opentui/solid/preload",
      path.join(import.meta.dir, "tracking.fixture.ts"), mode,
    ], { cwd: path.join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
    assert.equal(exit, 0, stdout + stderr)
  })
}
