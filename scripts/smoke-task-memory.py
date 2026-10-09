# /// script
# requires-python = ">=3.10"
# dependencies = ["pyte==0.8.2"]
# ///
"""Exercise the installed trial without model prompts or a server restart.

Usage: uv run scripts/smoke-task-memory.py SESSION_ID OTHER_WORKTREE OTHER_PROJECT
The linked session's record is read only. A separate smoke-test task and session
are created for terminal checks. The completed test record is kept as history.
"""

import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

import pyte


def api(method, path, body=None, directory=None, expected_error=None):
    if directory:
        path += "?" + urlencode({"location[directory]": str(directory)})
    args = ["opencode", "api", method, path]
    if body is not None:
        args += ["--data", json.dumps(body)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if expected_error:
        assert result.returncode != 0, result.stdout
        assert expected_error in result.stdout + result.stderr, result.stdout + result.stderr
        return None
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return json.loads(result.stdout) if result.stdout.strip() else None


def rpc(method, session_id, directory, change=None):
    payload = {"sessionID": session_id}
    if change:
        payload["change"] = change
    return api("post", f"/api/rpc/task-memory/{method}", {"input": payload}, directory)["output"]


class Terminal:
    def __init__(self, session_id, directory):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 180, 0, 0))
        env = os.environ.copy()
        env.update(TERM="xterm-256color", COLORTERM="truecolor")
        settings = json.loads(env.get("OPENCODE_CLI_CONFIG_CONTENT", "{}"))
        settings.update(animations=False, tabs={"mode": "off"})
        env["OPENCODE_CLI_CONFIG_CONTENT"] = json.dumps(settings)
        self.process = subprocess.Popen(
            ["opencode", "--session", session_id, str(directory)],
            stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True,
        )
        os.close(slave)
        self.screen = pyte.Screen(180, 50)
        self.stream = pyte.Stream(self.screen)

    def text(self):
        return "\n".join(line.rstrip() for line in self.screen.display)

    def wait(self, predicate, label):
        started = time.monotonic()
        while time.monotonic() - started < 25 and self.process.poll() is None:
            text = self.text()
            if predicate(text):
                return text
            if select.select([self.master], [], [], 0.1)[0]:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                self.stream.feed(data.decode(errors="replace"))
                if b"\x1b[6n" in data:
                    self.send(b"\x1b[1;1R")
        raise RuntimeError(f"Did not reach {label}:\n{self.text()}")

    def send(self, value):
        os.write(self.master, value)

    def command(self, name):
        self.send(name.encode())
        title = {
            "/task-memory": "Open task memory",
            "/task-memory-question": "Record a pending question",
            "/task-memory-link": "Link this session to a task",
        }[name]
        self.wait(lambda text: title in text, f"{name} completion")
        self.send(b"\r")

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait()
        os.close(self.master)


session_id, other_worktree, other_project = sys.argv[1:]
directory = Path.cwd()
linked = rpc("read", session_id, directory)
assert linked["task"], "Link the current session to a trial task first"
assert rpc("read", session_id, other_worktree)["task"] == linked["task"]
api("post", "/api/rpc/task-memory/read", {"input": {"sessionID": session_id}},
    other_project, expected_error="Session belongs to another project")
print("PASS: cross-worktree read and cross-project rejection")

created = api("post", "/api/session", {
    "title": "Task memory smoke check", "location": {"directory": str(directory)},
})
smoke_id = created["data"]["id"]
terminal = None
passed = False
try:
    task = rpc("update", smoke_id, directory, {"operation": "create", "title": "Task memory smoke check"})
    assert task["taskID"] and "task" not in task, "Updates must return compact status, not full history"
    rpc("update", smoke_id, directory, {
        "operation": "decision", "status": "accepted", "text": "Smoke-test decision",
        "reason": "Synthetic fixture for the installed plugin check, not a user approval",
    })
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda index: rpc("update", smoke_id,
            directory if index % 2 == 0 else other_worktree,
            {"operation": "question", "blocking": True, "text": f"Smoke-test question {index}"}), range(4)))
    before = rpc("read", smoke_id, directory)
    assert len(before["task"]["questions"]) == 4, before
    rpc("update", smoke_id, directory, {
        "operation": "checkpoint", "status": "active", "summary": "Smoke checkpoint",
        "done": ["Created the fixture"], "remaining": ["Check the terminal"], "needsInput": [],
    })
    print("PASS: live concurrent updates across worktrees")
    terminal = Terminal(smoke_id, directory)
    terminal.wait(lambda text: "Task: Task memory smoke check" in text, "session composer")
    terminal.wait(lambda text: "YOUR INPUT NEEDED: Smoke-test question" in text, "blocking reminder")
    terminal.command("/task-memory")
    terminal.wait(lambda text: "Smoke checkpoint" in text and "Smoke-test decision" in text,
                  "task panel with checkpoint and decision")
    terminal.send(b"h")
    terminal.wait(lambda text: "History" in text, "task history")
    terminal.send(b"h")
    for question in before["task"]["questions"]:
        rpc("update", smoke_id, directory, {"operation": "answer", "questionID": question["id"],
            "answer": "Synthetic fixture answered by the smoke check"})
    terminal.wait(lambda text: "No unanswered questions." in text and "YOUR INPUT NEEDED" not in text,
                  "live answer refresh")
    print("PASS: terminal panel, history, blocking reminder, and answer refresh")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "h: history" not in text, "closed task panel")
    terminal.command("/task-memory-question")
    terminal.wait(lambda text: "Question" in text and "enter submit" in text, "question dialog")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "enter submit" not in text, "cancelled question dialog")
    terminal.command("/task-memory-link")
    terminal.wait(lambda text: "Link a task in this project" in text, "task picker")
    terminal.send(b"\x1b")
    assert len(rpc("read", smoke_id, directory)["task"]["questions"]) == 4
    print("PASS: terminal dialogs and cancellation")
    rpc("update", smoke_id, directory, {
        "operation": "checkpoint", "status": "completed", "summary": "Initial smoke checks passed",
        "done": ["Checked the terminal"], "remaining": [], "needsInput": [],
    })
    reopened = rpc("update", smoke_id, directory, {
        "operation": "question", "blocking": True, "text": "After-completion smoke blocker",
    })
    assert reopened["status"] == "active" and reopened["questionID"]
    assert rpc("read", smoke_id, directory)["task"]["checkpoints"][-1]["status"] == "completed"
    terminal.wait(lambda text: "YOUR INPUT NEEDED: After-completion smoke blocker" in text, "late blocker reminder")
    print("PASS: compact update responses and active status after a new blocker")
    passed = True
finally:
    if terminal:
        terminal.close()
    view = rpc("read", smoke_id, directory)
    if view["task"]:
        for question in view["task"]["questions"]:
            if not question["answers"]:
                rpc("update", smoke_id, directory, {"operation": "answer", "questionID": question["id"],
                    "answer": "Synthetic fixture ended; this is not a real pending question"})
        rpc("update", smoke_id, directory, {
            "operation": "checkpoint", "status": "completed" if passed else "active",
            "summary": "Smoke check passed" if passed else "Smoke check failed or did not finish",
            "done": ["See smoke command output for checks that passed"],
            "remaining": [] if passed else ["Rerun the failed or unverified smoke check"], "needsInput": [],
        })
    api("delete", f"/api/session/{smoke_id}")
