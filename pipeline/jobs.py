"""Operator CLI for the Phase 2 queue. Phase 3's web app replaces most of it.

    python -m pipeline.jobs migrate
    python -m pipeline.jobs seed --allow-fixture-sources
    python -m pipeline.jobs enqueue barbarians-01
    python -m pipeline.jobs status [JOB]
    python -m pipeline.jobs cancel JOB | retry JOB
    python -m pipeline.jobs workers
    python -m pipeline.jobs adduser NAME --display "Full Name"
    python -m pipeline.jobs passwd NAME | signout-all NAME
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import sys
from pathlib import Path

from . import config, docs
from .store import Store

FIXTURES = Path(__file__).resolve().parent / "fixtures"

#: A worker whose last poll or heartbeat is older than this is shown offline.
#: Three missed heartbeats, so one slow round trip does not raise the banner.
OFFLINE_AFTER_SECONDS = 45


def _report(r: docs.Report) -> dict:
    return {"errors": r.errors, "warnings": r.warnings}


def cmd_migrate(store: Store, args) -> int:
    applied = store.migrate()
    print("applied " + ", ".join(applied) if applied else "schema is current")
    return 0


def cmd_seed(store: Store, args) -> int:
    """Load a project from a research.md + script.md pair, as the scripting UI would.

    Each document is validated and stored with the status the validator gives
    it. `--allow-fixture-sources` is the same override as the slice's: without
    it the Phase 1 fixture's research is `invalid`, and nothing can be enqueued
    against it.
    """
    store.migrate()
    style = config.PHASE1_STYLE
    store.upsert_style(style.style_id, style.preset, style.to_record(), is_library=True)

    research = docs.parse_research(args.research)
    script = docs.parse_script(args.script)
    project = args.project or script.meta.get("project")
    if not project:
        print("script.md has no `project` in its front matter; pass --project", file=sys.stderr)
        return 1
    store.upsert_project(project, topic=research.meta.get("topic", project),
                         target_duration=script.target_duration, style_id=style.style_id)

    r_report = docs.validate_research(research, allow_fixture_sources=args.allow_fixture_sources)
    r_row = store.add_artifact(project, "research", research.raw,
                               doc_status="approved" if r_report.ok else "invalid",
                               report=_report(r_report))
    s_report = docs.validate_script(script, research)
    s_row = store.add_artifact(project, "script", script.raw,
                               doc_status="approved" if s_report.ok else "invalid",
                               report=_report(s_report), upstream_hash=r_row["content_sha"])
    for row, rep in ((r_row, r_report), (s_row, s_report)):
        print(f"  {row['kind']}.md v{row['version']}: {row['doc_status']}")
        if rep.errors or rep.warnings:
            print(rep.render())
    print(f"project {project} (style {style.style_id})")
    return 0


def cmd_enqueue(store: Store, args) -> int:
    project = store.project(args.project)
    if project is None:
        print(f"no project {args.project!r}; seed it first", file=sys.stderr)
        return 1
    research = store.latest_approved(args.project, "research")
    script = store.latest_approved(args.project, "script")
    missing = [k for k, row in (("research.md", research), ("script.md", script)) if row is None]
    if missing:
        print(f"{args.project} has no approved {' or '.join(missing)}", file=sys.stderr)
        return 1
    payload = {
        "research_id": research["id"], "script_id": script["id"],
        "style_id": project["style_id"], "target_shots": args.shots,
        "allow_fixture_sources": args.allow_fixture_sources, "force": args.force,
    }
    if args.fake:
        payload["fake"] = True
    if args.render_size:
        w, h = (int(x) for x in args.render_size.lower().split("x"))
        payload["render_size"] = [w, h]
    try:
        job_id = store.enqueue(args.project, "production", payload, max_attempts=args.max_attempts)
    except Exception as exc:
        if "jobs_one_live_per_project" in str(exc):
            print(f"{args.project} already has a queued or running production job", file=sys.stderr)
            return 1
        raise
    print(f"job {job_id}: production for {args.project} "
          f"(research v{research['version']}, script v{script['version']})")
    return 0


def _ago(ts, now) -> str:
    if ts is None:
        return "-"
    s = (now - ts).total_seconds()
    return f"{s:.0f}s ago" if s < 120 else f"{s / 60:.0f}m ago"


def cmd_status(store: Store, args) -> int:
    now = store._one("SELECT now() AS t")["t"]
    if args.job is None:
        rows = store.jobs(args.limit)
        if not rows:
            print("no jobs")
        for j in rows:
            p = j["progress"] or {}
            where = p.get("stage", "-")
            if where == "images" and "total" in p:
                where = f"images {p['done']}/{p['total']}"
            lease = ""
            if j["state"] == "running":
                left = (j["lease_expires_at"] - now).total_seconds()
                lease = f"  lease {left:+.0f}s, beat {_ago(j['heartbeat_at'], now)}"
            print(f"  {j['id']:>4}  {j['project_id']:<16} {j['state']:<9} {where:<14} "
                  f"try {j['attempts']}/{j['max_attempts']}  {j['claimed_by'] or ''}{lease}")
            if j["error"]:
                print(f"        {j['error'][:160]}")
        return 0

    j = store.job(args.job)
    if j is None:
        print(f"no job {args.job}", file=sys.stderr)
        return 1
    print(json.dumps({k: j[k] for k in ("id", "project_id", "state", "attempts",
                                         "max_attempts", "claimed_by", "progress", "error")},
                     indent=2, default=str))
    print("events:")
    for e in store.events(args.job):
        d = e["data"]
        if e["kind"] == "shot":
            detail = f"{d['shot']} {d['source']}" + (f" in {d['seconds']}s" if d["generated"] else "")
        elif e["kind"] == "stage":
            detail = d["stage"]
        else:
            detail = json.dumps({k: v for k, v in d.items() if k != "traceback"}, default=str)[:160]
        print(f"  {e['at']:%H:%M:%S}  try {e['attempt']}  {e['kind']:<8} {detail}")
    return 0


def cmd_cancel(store: Store, args) -> int:
    ok = store.cancel(args.job)
    print(f"job {args.job} cancelled" if ok else f"job {args.job} is not queued or running")
    return 0 if ok else 1


def cmd_retry(store: Store, args) -> int:
    ok = store.requeue(args.job)
    print(f"job {args.job} requeued" if ok else f"job {args.job} is not failed or cancelled")
    return 0 if ok else 1


def cmd_workers(store: Store, args) -> int:
    rows = store.workers()
    if not rows:
        print("no workers have ever polled")
    for w in rows:
        online = w["age_seconds"] < OFFLINE_AFTER_SECONDS
        job = f"job {w['current_job']}" if w["current_job"] else "idle"
        print(f"  {'online ' if online else 'OFFLINE'}  {w['id']}  pid {w['pid']}  "
              f"seen {w['age_seconds']:.0f}s ago  {job}")
    return 0


#: scrypt parameters for new passwords. They are stored in each hash, so they
#: can be raised later without invalidating existing accounts. N=2^15, r=8
#: costs ~32 MB and ~60 ms per check: fine for a login, slow for a guesser.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**15, 8, 1


def hash_password(password: str) -> str:
    """The format web/lib/session.ts verifies: scrypt$N$r$p$salt$hash."""
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                            maxmem=256 * SCRYPT_N * SCRYPT_R, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}"


def _read_password() -> str:
    if not sys.stdin.isatty():           # piped, for scripts and tests
        return sys.stdin.readline().rstrip("\n")
    first = getpass.getpass("password: ")
    if first != getpass.getpass("again: "):
        raise SystemExit("passwords do not match")
    return first


def cmd_adduser(store: Store, args) -> int:
    store.migrate()
    password = _read_password()
    if len(password) < 10:
        print("use at least 10 characters", file=sys.stderr)
        return 1
    row = store.conn.execute(
        "INSERT INTO users (username, display_name, password_hash) VALUES (%s, %s, %s) "
        "ON CONFLICT (username) DO NOTHING RETURNING id",
        (args.username, args.display or args.username, hash_password(password)),
    ).fetchone()
    if row is None:
        print(f"{args.username} already exists; use passwd to change the password", file=sys.stderr)
        return 1
    print(f"user {args.username} (id {row['id']})")
    return 0


def cmd_passwd(store: Store, args) -> int:
    password = _read_password()
    if len(password) < 10:
        print("use at least 10 characters", file=sys.stderr)
        return 1
    # A new password also signs out every existing session.
    cur = store.conn.execute(
        "UPDATE users SET password_hash = %s, session_epoch = session_epoch + 1 WHERE username = %s",
        (hash_password(password), args.username))
    print("password changed; existing sessions signed out" if cur.rowcount else "no such user")
    return 0 if cur.rowcount else 1


def cmd_signout_all(store: Store, args) -> int:
    cur = store.conn.execute(
        "UPDATE users SET session_epoch = session_epoch + 1 WHERE username = %s", (args.username,))
    print("signed out everywhere" if cur.rowcount else "no such user")
    return 0 if cur.rowcount else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.jobs")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("migrate")

    s = sub.add_parser("seed", help="load a research.md + script.md pair as a project")
    s.add_argument("--project", default=None)
    s.add_argument("--script", type=Path, default=FIXTURES / "barbarians-01.script.md")
    s.add_argument("--research", type=Path, default=FIXTURES / "barbarians-01.research.md")
    s.add_argument("--allow-fixture-sources", action="store_true")

    e = sub.add_parser("enqueue", help="queue a production job on the latest approved artifacts")
    e.add_argument("project")
    e.add_argument("--shots", type=int, default=config.TARGET_SHOTS)
    e.add_argument("--allow-fixture-sources", action="store_true")
    e.add_argument("--force", action="store_true")
    e.add_argument("--max-attempts", type=int, default=3)
    e.add_argument("--render-size", default=None, help="e.g. 640x360 for a fast preview")
    e.add_argument("--fake", action="store_true", help="for a `worker --fake` only")

    st = sub.add_parser("status")
    st.add_argument("job", type=int, nargs="?")
    st.add_argument("--limit", type=int, default=15)

    for name in ("cancel", "retry"):
        c = sub.add_parser(name)
        c.add_argument("job", type=int)

    sub.add_parser("workers")

    u = sub.add_parser("adduser", help="create a web app account (password read from the terminal)")
    u.add_argument("username")
    u.add_argument("--display", default=None, help="name shown in the app and the audit trail")
    for name in ("passwd", "signout-all"):
        sub.add_parser(name).add_argument("username")

    args = ap.parse_args(argv)
    with Store() as store:
        return {
            "migrate": cmd_migrate, "seed": cmd_seed, "enqueue": cmd_enqueue,
            "status": cmd_status, "cancel": cmd_cancel, "retry": cmd_retry,
            "workers": cmd_workers, "adduser": cmd_adduser, "passwd": cmd_passwd,
            "signout-all": cmd_signout_all,
        }[args.cmd](store, args)


if __name__ == "__main__":
    sys.exit(main())
