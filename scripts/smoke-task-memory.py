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
import signal
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


def rpc(method, session_id, directory, change=None, scope=None):
    payload = {"sessionID": session_id}
    if change:
        payload["change"] = change
    if scope:
        payload["scope"] = scope
    return api("post", f"/api/rpc/task-memory/{method}", {"input": payload}, directory)["output"]


class Terminal:
    def __init__(self, session_id, directory):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 180, 0, 0))
        env = os.environ.copy()
        env.update(TERM="xterm-256color", COLORTERM="truecolor")
        settings = json.loads(env.get("OPENCODE_CLI_CONFIG_CONTENT", "{}"))
        settings.update(animations=False, tabs={"mode": "off"})
        settings["keybinds"] = {**settings.get("keybinds", {}), "session.list": "ctrl+y"}
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

    def sidebar_text(self):
        # Placement in the existing right-hand sidebar is the UI contract under test.
        return "\n".join(line[self.screen.columns // 2:].rstrip() for line in self.screen.display)

    def wait(self, predicate, label):
        started = time.monotonic()
        while time.monotonic() - started < 25 and self.process.poll() is None:
            if select.select([self.master], [], [], 0.1)[0]:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                self.stream.feed(data.decode(errors="replace"))
                if b"\x1b[6n" in data:
                    self.send(b"\x1b[1;1R")
            else:
                # A redraw can span several reads. Inspect only after draining it.
                text = self.text()
                if predicate(text):
                    return text
        raise RuntimeError(f"Did not reach {label}:\n{self.text()}")

    def send(self, value):
        os.write(self.master, value)

    def resize(self, width, height):
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        self.screen.resize(lines=height, columns=width)
        self.process.send_signal(signal.SIGWINCH)

    def command(self, name):
        self.send(name.encode())
        title = {
            "/task-memory": "Open task memory",
            "/task-memory-project": "Open all project findings",
            "/task-memory-question": "Record a pending question",
            "/task-memory-link": "Link this session to a task",
            "/task-memory-finding": "Record or update a project finding",
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
switch_id = None
fixture_findings = []
passed = False
try:
    for kind, title in (
        ("verification", "Fixture compaction check missing"),
        ("bug", "Fixture plugin load failure"),
        ("risk", "Fixture missing-worktree reference"),
    ):
        change = {"operation": "finding", "kind": kind, "status": "open", "text": title,
                  "reason": "Synthetic smoke fixture, not a real project defect; check sidebar persistence"}
        result = rpc("update", smoke_id, directory, change)
        assert result["taskID"] is None and result["findingID"], "Project findings must work without a task link"
        fixture_findings.append({**change, "findingID": result["findingID"]})
    task = rpc("update", smoke_id, directory, {"operation": "create", "title": "Task memory smoke check"})
    assert task["taskID"] and "task" not in task, "Updates must return compact status, not full history"
    task_finding = {"operation": "finding", "kind": "risk", "status": "open", "text": "Fixture linked-task follow-up",
                    "reason": "Synthetic finding for explicit task-link visibility"}
    result = rpc("update", smoke_id, directory, task_finding)
    task_finding = {**task_finding, "findingID": result["findingID"]}
    fixture_findings.append(task_finding)
    rpc("update", smoke_id, directory, {
        "operation": "decision", "status": "accepted", "text": "Smoke-test decision",
        "reason": "Synthetic fixture for the installed plugin check, not a user approval",
    })
    rpc("update", smoke_id, directory, {
        "operation": "decision", "status": "rejected", "text": "Smoke-test alternative",
        "reason": "Synthetic rejected alternative for checking the sidebar",
    })
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda index: rpc("update", smoke_id,
            directory if index % 2 == 0 else other_worktree,
            {"operation": "question", "blocking": True, "text": f"Smoke-test question {index}"}), range(4)))
    before = rpc("read", smoke_id, directory)
    assert len(before["task"]["questions"]) == 4, before
    current_findings = list({entry["id"]: entry for entry in before["findings"]}.values())
    current_open = [entry for entry in current_findings if entry["status"] == "open"]
    total_open = len(current_open)
    rpc("update", smoke_id, directory, {
        "operation": "checkpoint", "status": "active", "summary": "Smoke checkpoint",
        "done": ["Created the fixture"], "remaining": ["Check the terminal"], "needsInput": ["Fixture input"],
    })
    print("PASS: live concurrent updates across worktrees")
    terminal = Terminal(smoke_id, directory)
    terminal.wait(lambda text: "Task: Task memory smoke check" in text, "session composer")
    terminal.wait(lambda text: "YOUR INPUT NEEDED: Smoke-test question" in text, "blocking reminder")
    terminal.wait(lambda text: "Open findings" in terminal.sidebar_text() and
                  all(entry["text"][:159] in terminal.sidebar_text() for entry in current_open[:6]),
                  "persistent right-hand sidebar")
    if total_open > 6:
        assert f"+ {total_open - 6} more open findings" in terminal.sidebar_text()
    assert "h: history" not in terminal.text(), "The summary must not require opening the full panel"
    assert all(value not in terminal.sidebar_text() for value in (
        "Checkpoint:", "Needs input:", "Questions:", "Accepted:", "Rejected:", "Smoke-test question",
    )), "The sidebar must show findings, not duplicate the task conversation"
    rpc("update", smoke_id, directory, {
        "operation": "checkpoint", "status": "active", "summary": "Live sidebar update",
        "done": ["Created the fixture"], "remaining": ["Check the terminal"], "needsInput": ["Fixture input"],
    })
    verification = fixture_findings[0]
    rpc("update", smoke_id, directory, {**verification, "status": "resolved", "reason": "Synthetic fixture verified"})
    terminal.wait(lambda text: f"{total_open - 1} open" in terminal.sidebar_text() and
                  verification["text"] not in terminal.sidebar_text(), "resolved finding leaves sidebar")
    rpc("update", smoke_id, directory, {**verification, "reason": "Synthetic fixture reopened for persistence checks"})
    terminal.wait(lambda text: f"{total_open} open" in terminal.sidebar_text(), "reopened finding returns to sidebar")
    bug = fixture_findings[1]
    rpc("update", smoke_id, directory, {**bug, "status": "deferred", "reason": "Synthetic user deferral fixture"})
    terminal.wait(lambda text: f"{total_open - 1} open" in terminal.sidebar_text() and bug["text"] not in terminal.sidebar_text(),
                  "deferred finding leaves open list")
    rpc("update", smoke_id, directory, {**bug, "reason": "Synthetic fixture reopened"})
    terminal.wait(lambda text: f"{total_open} open" in terminal.sidebar_text(), "reopened deferred finding")
    print("PASS: findings-only sidebar, kind labels, resolution, deferral, and reopening")
    terminal.resize(180, max(80, 60 + 12 * total_open))
    terminal.command("/task-memory")
    terminal.wait(lambda text: "h: history" in text and "Live sidebar update" in text and "Smoke-test decision" in text,
                  "task panel with checkpoint and decision")
    terminal.send(b"h")
    terminal.wait(lambda text: "Finding history" in text, "finding history")
    terminal.send(b"h")
    for question in before["task"]["questions"]:
        rpc("update", smoke_id, directory, {"operation": "answer", "questionID": question["id"],
            "answer": "Synthetic fixture answered by the smoke check"})
    terminal.wait(lambda text: "No unanswered questions." in text and "YOUR INPUT NEEDED" not in text,
                  "live answer refresh")
    print("PASS: terminal panel, history, blocking reminder, and answer refresh")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "h: history" not in text, "closed task panel")
    terminal.wait(lambda text: f"{total_open} open" in terminal.sidebar_text() and "Questions:" not in terminal.sidebar_text(),
                  "findings unchanged after answering task questions")
    terminal.command("/task-memory-question")
    terminal.wait(lambda text: "Question" in text and "enter submit" in text, "question dialog")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "enter submit" not in text, "cancelled question dialog")
    terminal.command("/task-memory-link")
    terminal.wait(lambda text: "Link a task in this project" in text, "task picker")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "Link a task in this project" not in text, "cancelled task picker")
    assert len(rpc("read", smoke_id, directory)["task"]["questions"]) == 4
    print("PASS: terminal dialogs and cancellation")
    rpc("update", smoke_id, directory, {
        "operation": "checkpoint", "status": "completed", "summary": "Initial smoke checks passed",
        "done": ["Checked the terminal"], "remaining": [], "needsInput": [],
    })
    assert all(finding["text"] in {entry["text"] for entry in rpc("read", smoke_id, other_worktree)["findings"]}
               for finding in fixture_findings), "Task completion must not clear project findings"
    reopened = rpc("update", smoke_id, directory, {
        "operation": "question", "blocking": True, "text": "After-completion smoke blocker",
    })
    assert reopened["status"] == "active" and reopened["questionID"]
    assert rpc("read", smoke_id, directory)["task"]["checkpoints"][-1]["status"] == "completed"
    terminal.wait(lambda text: "YOUR INPUT NEEDED: After-completion smoke blocker" in text, "late blocker reminder")
    print("PASS: compact update responses and active status after a new blocker")
    terminal.resize(90, 50)
    terminal.wait(lambda text: "full record" not in text and "YOUR INPUT NEEDED: After-completion smoke blocker" in text,
                  "narrow terminal with composer reminder and no sidebar")
    terminal.resize(180, 50)
    terminal.wait(lambda text: "full record" in terminal.sidebar_text() and f"{total_open} open" in terminal.sidebar_text(),
                  "restored sidebar after widening the terminal")
    print("PASS: narrow-terminal fallback and restored sidebar")
    switched = api("post", "/api/session", {
        "title": "Sidebar switch check", "location": {"directory": str(directory)},
    })
    switch_id = switched["data"]["id"]
    terminal.send(b"\x19")
    terminal.wait(lambda text: "Sessions" in text, "session picker")
    terminal.send(b"Sidebar switch check")
    terminal.wait(lambda text: "Sidebar switch check" in text, "session picker result")
    terminal.send(b"\r")

    def new_session_visible(text):
        if "Sessions" in text:
            return False
        if "Sidebar switch check" in terminal.sidebar_text():
            assert "Smoke-test decision" not in text and "After-completion smoke blocker" not in text, \
                f"The previous session's task must not remain visible after switching sessions:\n{text}"
        return ("Sidebar switch check" in terminal.sidebar_text() and "0 open" in terminal.sidebar_text()
                and "After-completion smoke blocker" not in text)

    terminal.wait(new_session_visible, "new session without stale task data")
    print("PASS: session switch without previous-task data")
    switched_view = rpc("read", switch_id, directory)
    assert switched_view["task"] is None
    assert switched_view["findings"] == [] and switched_view["scope"] == "current"
    assert all(entry["text"] not in terminal.sidebar_text() for entry in fixture_findings)
    project_view = rpc("read", switch_id, directory, scope="project")
    assert project_view["scope"] == "project"
    assert {entry["findingID"] for entry in fixture_findings}.issubset({entry["id"] for entry in project_view["findings"]})
    project_open = len([entry for entry in {entry["id"]: entry for entry in project_view["findings"]}.values()
                        if entry["status"] == "open"])
    terminal.resize(180, max(80, 60 + 12 * project_open))
    terminal.command("/task-memory-project")
    terminal.wait(lambda text: "All project findings" in text and verification["text"] in text,
                  "explicit all-project view")
    terminal.send(b"p")
    terminal.wait(lambda text: "Current task/session" in text and verification["text"] not in text,
                  "current scope restored without retained project data")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "h: history" not in text and "0 open" in terminal.sidebar_text(), "default sidebar stays scoped")
    assert rpc("read", switch_id, directory)["findings"] == [], "An explicit project view must not change the default read scope"
    print("PASS: unrelated sessions hide findings; explicit project view preserves history without changing defaults")
    terminal.resize(180, 90)
    terminal.command("/task-memory-finding")
    terminal.wait(lambda text: "Current task/session findings" in text, "finding picker")
    terminal.send(b"Record a new open finding")
    terminal.wait(lambda text: "Record a new open finding" in text, "new finding option")
    terminal.send(b"\r")
    terminal.wait(lambda text: "Finding kind" in text, "finding kind picker")
    terminal.send(b"Not verified")
    terminal.wait(lambda text: "Not verified" in text, "verification option")
    terminal.send(b"\r")
    terminal.wait(lambda text: "Actionable finding or verification gap" in text, "finding text prompt")
    terminal.send(b"Fixture dialog submission\r")
    terminal.wait(lambda text: "Evidence / reason (state what is not verified)" in text, "finding evidence prompt")
    terminal.send(b"Synthetic fixture for the new finding dialog, not a real project gap\r")
    terminal.wait(lambda text: "Fixture dialog submission" in text and "No task linked to this session." in text,
                  "finding saved from an unlinked session")
    dialog_view = rpc("read", switch_id, directory)
    dialog_finding = next(entry for entry in dialog_view["findings"] if entry["text"] == "Fixture dialog submission")
    assert dialog_finding["kind"] == "verification" and dialog_finding["status"] == "open" and dialog_finding["taskID"] is None
    fixture_findings.append({"operation": "finding", "findingID": dialog_finding["id"], "kind": "verification",
                             "status": "open", "text": dialog_finding["text"], "reason": dialog_finding["reason"]})
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "h: history" not in text, "closed findings panel")
    terminal.wait(lambda text: "1 open" in terminal.sidebar_text(), "finding dialog sidebar refresh")
    terminal.command("/task-memory-finding")
    terminal.wait(lambda text: "Current task/session findings" in text, "finding picker for status change")
    terminal.send(b"Fixture dialog submission")
    terminal.wait(lambda text: "Fixture dialog submission" in text, "existing finding option")
    terminal.send(b"\r")
    terminal.wait(lambda text: "Update this finding" in text, "finding action picker")
    terminal.send(b"\r")
    terminal.wait(lambda text: "Finding status" in text, "finding status picker")
    terminal.send(b"Resolve")
    terminal.wait(lambda text: "Resolve" in text, "resolve option")
    terminal.send(b"\r")
    terminal.wait(lambda text: "Evidence that closes this finding" in text, "resolution evidence prompt")
    terminal.send(b"Live finding dialog creation and resolution passed; this is a synthetic fixture\r")
    terminal.wait(lambda text: "Approve resolution with the recorded evidence?" in text, "resolution confirmation")
    terminal.send(b"Approve resolution")
    terminal.wait(lambda text: "Approve resolution" in text, "approval option")
    terminal.send(b"\r")
    terminal.wait(lambda text: "h: history" in text and "Fixture dialog submission" not in text, "resolved finding removed")
    revisions = [entry for entry in rpc("read", switch_id, directory)["findings"] if entry["id"] == dialog_finding["id"]]
    assert revisions[-1]["status"] == "resolved" and revisions[-1]["kind"] == "verification"
    assert revisions[-1]["text"] == dialog_finding["text"] and revisions[-1]["taskID"] is None
    terminal.send(b"h")
    terminal.wait(lambda text: "Finding history" in text and "Fixture dialog submission" in text,
                  "resolved finding revision history in an unlinked session")
    print("PASS: finding creation and confirmed resolution through terminal dialogs, with preserved history")
    terminal.send(b"\x1b")
    terminal.wait(lambda text: "h: history" not in text, "closed history panel")
    rpc("update", switch_id, directory, {"operation": "link", "taskID": task["taskID"]})
    linked_view = rpc("read", switch_id, directory)
    assert linked_view["task"]["id"] == task["taskID"]
    linked_current = list({entry["id"]: entry for entry in linked_view["findings"]}.values())
    assert [entry["id"] for entry in linked_current if entry["status"] == "open"] == [task_finding["findingID"]]
    terminal.wait(lambda text: task_finding["text"] in terminal.sidebar_text() and "1 open" in terminal.sidebar_text(),
                  "finding follows explicitly linked task")
    assert verification["text"] not in terminal.sidebar_text(), "Session-only findings must not follow a different session's task link"
    print("PASS: task-linked findings follow explicit links; session-only findings remain private to their origin session")
    passed = True
finally:
    if terminal:
        terminal.close()
    for finding in fixture_findings:
        rpc("update", smoke_id, directory, {**finding, "status": "resolved",
            "reason": "Synthetic fixture ended; no real issue is being marked fixed"})
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
    if switch_id:
        api("delete", f"/api/session/{switch_id}")
