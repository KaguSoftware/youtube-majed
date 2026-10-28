"""Claude writes the research and the script: `claude -p` on the worker.

This is one of the two ways a document slot gets filled; the other is a human
paste in the web app. Both end in `docs.check`, and nothing downstream can
tell them apart (DESIGN.md, "Slot filling is mode-agnostic"). What only this
path has is the `prompt_log` row: every prompt and its raw response, kept so
a claim that draws a correction can be traced to the exact text that made it.

Claude runs headless on the worker's existing Claude Code sign-in, in an
empty temporary directory so no project instructions leak into the prompt,
with only the web tools it needs. Not `--bare`: bare mode skips the keychain,
which is where a subscription sign-in lives.

Failures split the way the worker's do:

- Claude says no (usage limit, auth): `WriterGate`, not retried. The message
  points at paste mode, which is failure mode 12's mitigation.
- Claude ran but the document is malformed: stored anyway, as an `invalid`
  artifact with the validator's errors, so the user sees what was written and
  can fix or replace it. A retry would cost another run and likely repeat.
- Timeouts and crashes: ordinary exceptions; the worker retries with backoff.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import date

from . import docs
from .timeline import text_sha

#: The CLI to run. Tests point this at a stand-in that prints a canned reply.
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

#: Research reads many pages; a script is a single long write. Sized for the
#: longest film (10 minutes: ~70 claims, ~50 beats) and generous, since the
#: heartbeat thread holds the lease while Claude works.
TIMEOUT_SECONDS = {"research": 40 * 60, "script": 20 * 60}

#: Words per second the script is budgeted at: docs.WPM, the validator's own.
WORDS_PER_SECOND = docs.WPM / 60

MODEL = os.environ.get("CLAUDE_MODEL", "opus")


class WriterGate(RuntimeError):
    """Claude declined to run (limit, auth). Retrying soon would repeat it."""


# ------------------------------------------------------------ narratives

@dataclass(frozen=True)
class Narrative:
    """How a film is told. Chosen per film and carried into both prompts:
    the script is written in it, and the research gathers what it needs.
    Without one the script reads as a lesson: facts in order, each beat
    explaining the next. web/lib/narratives.ts lists the same ids for the
    picker; selftest checks the two agree."""
    label: str
    research: str
    script: str


NARRATIVES: dict[str, Narrative] = {
    "story": Narrative(
        label="A life",
        research=(
            "The film follows one ordinary person through their life, so gather what such a "
            "person did, owned, ate, feared and hoped for, in the order it happened to them: "
            "a typical day or year, the work, the dangers, the turning points of a life like "
            "theirs. Recorded experiences of real individuals of that kind are especially valuable."
        ),
        script=(
            "Tell it as the story of the protagonist's life, not a survey of their world.\n"
            "- Open in a scene: the protagonist doing something, at a moment that matters.\n"
            "- Give them something they want or fear, and let the film follow whether they get it.\n"
            "- The facts arrive as things that happen to them, things they hold, see and do. "
            "\"Rations were wheat and beer\" becomes the protagonist breaking bread at dusk.\n"
            "- Move forward in time: a day, a season or a life, with a clear turn in the middle.\n"
            "- End on them, in an image, never on a summary of what we learned."
        ),
    ),
    "mystery": Narrative(
        label="A mystery",
        research=(
            "The film is told as a mystery, so gather the puzzle and its evidence: what was found "
            "or recorded that is strange, what people first believed, which evidence changed the "
            "picture and how, and what is still unknown."
        ),
        script=(
            "Tell it as a mystery the viewer solves alongside the narrator.\n"
            "- Open on the puzzle: a strange object, an unexplained event, a question that nags. "
            "Do not answer it yet.\n"
            "- Reveal the evidence like clues, one per beat, each changing what we think.\n"
            "- Let a wrong answer look right for a while, then turn it.\n"
            "- Hold the answer back until near the end. Where the research says the evidence is "
            "uncertain, the mystery stays partly open, and the ending says so plainly.\n"
            "- The protagonist is the one who lived inside the answer: show them in the "
            "reconstructed past as the clues add up."
        ),
    ),
    "chronicle": Narrative(
        label="A chronicle",
        research=(
            "The film is told as a sequence of events with a dramatic arc, so gather the events "
            "in order with what caused each one: the situation before, the pressures, the "
            "turning point, the consequences, and how ordinary people lived through it."
        ),
        script=(
            "Tell it as a chronicle with momentum: events in order, each one causing the next.\n"
            "- Open on the world as it was, and the first crack in it.\n"
            "- Build pressure beat by beat: connect beats with cause and consequence "
            "(\"so\", \"but\", \"and then\"), never with \"another thing to know\".\n"
            "- One clear turning point, roughly two thirds of the way in.\n"
            "- The protagonist lives through the events as a witness: their small moments carry "
            "the large ones.\n"
            "- End on what was left afterwards, as an image."
        ),
    ),
    "you": Narrative(
        label="You are there",
        research=(
            "The film puts the viewer in the protagonist's place, so gather sensory and "
            "practical detail of their daily experience: what they would see, hear, smell, eat, "
            "wear and carry, the routines, the rules they lived under, the risks they faced."
        ),
        script=(
            "Put the viewer in the protagonist's place: second person, present tense. "
            "\"You wake before first light. The hearth is cold.\"\n"
            "- The narration says \"you\" for the protagonist; the visuals still name them by "
            "their short name, since they are what gets painted.\n"
            "- Open in a body and a place: what you feel, hear and see.\n"
            "- Every fact is something you experience, handle or are told to do.\n"
            "- Give the day a shape: a task, a problem, a moment of danger or relief.\n"
            "- End on a single quiet moment, never on a summary."
        ),
    ),
    "explainer": Narrative(
        label="An explainer",
        research=(
            "The film answers one clear question, so gather the facts that answer it, the "
            "evidence behind each, and the common misconceptions it should correct."
        ),
        script=(
            "Tell it as an explainer: one clear question, answered step by step.\n"
            "- Open with the question, made vivid by a scene rather than stated flatly.\n"
            "- Each beat moves the answer forward; no beat is a list of facts.\n"
            "- Keep the protagonist on screen as the human face of the answer.\n"
            "- End with the answer in one line and an image that holds it."
        ),
    ),
}

#: Films created before narratives existed have none recorded.
DEFAULT_NARRATIVE = "story"


def narrative(narrative_id: str | None) -> tuple[str, Narrative]:
    nid = narrative_id or DEFAULT_NARRATIVE
    if nid not in NARRATIVES:
        raise ValueError(f"unknown narrative {nid!r}; one of {', '.join(NARRATIVES)}")
    return nid, NARRATIVES[nid]


@dataclass
class Written:
    markdown: str
    prompt: str
    system: str
    response_raw: str
    meta: dict


# --------------------------------------------------------------- prompts

RESEARCH_SYSTEM = """\
You are the research desk of a studio that makes narrated history documentaries.
Accuracy is the studio's only real claim. Every sentence a viewer hears must
trace back to a claim you wrote and a page you actually read.

Rules:
- One checkable fact per claim. Specific beats general: names, places,
  quantities, dates, materials, as the sources state them.
- Every claim cites exactly one source URL, and it must be a page you opened
  with WebFetch and read. Never cite a URL you did not open. Never construct
  or guess a URL. A search-result snippet is not a source.
- Prefer scholarly and institutional pages: museums, universities, national
  heritage bodies, archaeological reports, encyclopedias with named authors.
  Use popular or wiki pages only when nothing better covers the point.
- Where historians disagree or evidence is thin, say so inside the claim
  ("Most historians think...", "The evidence is mainly from one site...").
  Never smooth over uncertainty.
- Include concrete material detail a painter could use: buildings, clothing,
  tools, food, light, landscape. The film is illustrated shot by shot, and
  vague research produces anachronistic pictures.
- Stay on the topic and angle. Leave out what the angle excludes.
"""

RESEARCH_FORMAT = """\
Return the finished document and nothing else, inside one ```markdown fence,
in exactly this format (YAML front matter, then one `### cN` section per claim,
each section body a YAML mapping):

```markdown
---
project: {project}
research_version: 1
topic: {topic_yaml}
angle: {angle_yaml}
target_duration: {target_duration}
researched: {today}
---

## Claims

### c1 — short label
claim: One sentence stating the fact, with any uncertainty made explicit.
source: https://the-page-you-read.example/path

### c2 — short label
claim: ...
source: https://...
```

Number claims c1, c2, c3... in order. Write {claims_min} to {claims_max} claims.
Quote YAML values that contain a colon.
"""


def research_prompt(project: dict, note: str | None = None) -> tuple[str, str]:
    _, told = narrative(project.get("narrative"))
    duration = int(project.get("target_duration") or 180)
    n = max(8, round(duration / 9))
    fmt = RESEARCH_FORMAT.format(
        project=project["id"], topic_yaml=json.dumps(project["topic"]),
        angle_yaml=json.dumps(project.get("angle") or ""), target_duration=duration,
        today=date.today().isoformat(), claims_min=n, claims_max=n + 8,
    )
    lines = [
        f"Research this topic for a {duration // 60}-minute narrated documentary.",
        "",
        f"Topic: {project['topic']}",
        f"Angle: {project.get('angle') or '(none given: choose the most interesting honest angle)'}",
        "",
        f"How the film is told: {told.label.lower()}. {told.research}",
    ]
    if note:
        lines += ["", "Notes from the reviewer on the previous version:", note.strip()]
    lines += ["", fmt]
    return RESEARCH_SYSTEM, "\n".join(lines)


SCRIPT_SYSTEM = """\
You are the writer for a studio that makes narrated, illustrated history
documentaries. You write what the viewer hears, beat by beat, from approved
research only. The research is your material, not your outline: a film is a
story told with facts, never a lesson that recites them.

Rules for the story:
- Tell it in the way the brief asks (its "How to tell it" section). That
  choice shapes the opening, the order of the beats and the ending.
- Never lecture. No "in this video", no "let's look at", no "it's important
  to know", no "historians tell us" as a way in, no addressing the viewer as
  a student, no closing summary of what was covered.
- Scenes, not topics: each beat is a moment with a place, a person and
  something happening. A beat that only explains belongs inside a scene.
- Every beat pulls toward the next: a question raised, a cost coming due, a
  change on the way. The viewer should want the next beat.
- The protagonist is a representative figure, not a recorded person. Say so
  once, early and lightly ("No record keeps his name. Call him Victor."). What
  they do, own and suffer is what the research says people like them did, and
  those beats cite the claims. Never give a real, named historical person
  words or deeds the research does not record.

Rules for the narration:
- Grounding: every beat either cites the claims it relies on (`cites`) or is
  pure atmosphere that asserts no fact (`tone: true`). A tone beat may name
  the protagonist but no other name, no number, no date and no factual
  statement.
- Never state more than the cited claim supports, and keep its hedges.
- Write for the ear: short sentences, concrete nouns, present tense where it
  helps, no lists, no parentheses, no abbreviations, numbers written as words.
- Hit the word budget. It sets the film's length.

Rules for `visual` (each beat is painted as one to three still images, in a
dark oil-painting style, and every image is conditioned on ONE reference
character, so anyone shown prominently is painted as that same person):
- Follow one protagonist through the film: a single ordinary person the
  research supports (for example "the soldier"), named the same way in every
  visual where they appear. Other people appear only as secondary or distant
  figures. Where the narration is about someone else, show their hands, their
  tools or their work rather than their face, or show the protagonist
  watching. Never make a different person the main subject of a picture.
- The protagonist appears clearly in the first beat that shows people, so the
  look can be chosen on a frame of them.
- `period` in the front matter: era and region only, in a few words ("Roman
  Britain, about AD 100, the northern frontier"). It is added to every image
  prompt, so it must name no building, fort, wall or site: the image model
  turns any fort into a medieval stone castle, in every single shot.
- `protagonist` in the front matter: the short name the visuals use for them
  ("Victor"). `protagonist_look`: one line of exactly what they look like and
  wear, in period-specific terms the research supports ("a bearded Roman
  auxiliary soldier in an undyed wool tunic and leather belt, bareheaded").
  It is spliced into every visual that names them, so name them by that
  short name. The image model does not know history: "soldier" alone gets
  modern helmets. Spell out equipment, clothing and materials.
- Name every light source in period terms ("a clay oil lamp on the floor",
  "hearth light", "torchlight"); an unnamed "lamp" can come back electric.
- A concrete, paintable scene: setting, subject, action, light. One idea.
- Period-accurate, specifically: name the real material culture from the
  research ("a timber watchtower behind a turf rampart", not "a fort"; never
  medieval castles, plate armour or later architecture for earlier periods).
- Every beat a different setting or framing from its neighbours; never repeat
  a scene. Vary between wide landscapes, interiors and close details of
  hands, tools and objects.
- No text, writing, maps or diagrams in the picture.
- `mood`: two or three words of light and feeling, varying beat to beat.
"""

SCRIPT_FORMAT = """\
Return the finished script and nothing else, inside one ```markdown fence, in
exactly this format (YAML front matter, then one `### Bnn — title` section per
beat, each section body a YAML mapping; `narration` is a block scalar):

```markdown
---
project: {project}
script_version: 1
target_duration: {target_duration}
voice: {voice}
narrative: {narrative}
period: era and region only, no buildings or sites
protagonist: their short name as used in the visuals
protagonist_look: one line of what they look like and wear, period-specific
---

## Beats

### B01 — short title
narration: |
  The spoken words for this beat, in one or a few sentences.
visual: the scene to paint, concrete and period-accurate
mood: cold, blue, hushed
cites: [c2, c5]

### B02 — short title
narration: |
  ...
visual: ...
mood: ...
tone: true
```

Beats B01, B02... in order, {beats_min} to {beats_max} of them.
Word budget for all narration together: {words} words (within 10%).
Cite only claim ids that exist in the research below.
"""


def script_prompt(project: dict, research_md: str, note: str | None = None,
                  voice: str = "narrator_male_low") -> tuple[str, str]:
    nid, told = narrative(project.get("narrative"))
    duration = int(project.get("target_duration") or 180)
    words = round(duration * WORDS_PER_SECOND)
    beats = max(4, round(duration / 12))
    fmt = SCRIPT_FORMAT.format(
        project=project["id"], target_duration=duration, voice=voice, narrative=nid, words=words,
        beats_min=beats - 2, beats_max=beats + 3,
    )
    lines = [
        f"Write the narration script for a {duration // 60}-minute documentary.",
        "",
        f"Topic: {project['topic']}",
        f"Angle: {project.get('angle') or '(none given)'}",
        "",
        f"How to tell it: {told.label.lower()}.",
        told.script,
    ]
    if note:
        lines += ["", "Notes from the reviewer on the previous version:", note.strip()]
    lines += ["", fmt, "", "The approved research:", "", "```markdown", research_md.strip(), "```"]
    return SCRIPT_SYSTEM, "\n".join(lines)


# ------------------------------------------------------------- running it

FENCE = re.compile(r"```(?:markdown|md)?[ \t]*\n(.*?)\n```[ \t]*(?:\n|$)", re.S)


def extract_document(text: str) -> str:
    """The document from Claude's reply: the largest fenced block that looks
    like one, else everything from the first front-matter line. Whatever comes
    back is kept: an unusable reply still becomes an `invalid` version the
    user can read."""
    blocks = [b for b in FENCE.findall(text) if b.lstrip().startswith("---")]
    if blocks:
        return max(blocks, key=len).strip() + "\n"
    start = text.find("\n---\n") + 1 if not text.startswith("---") else 0
    return text[start:].strip() + "\n"


def run_claude(system: str, prompt: str, *, kind: str, should_stop=None, log=print) -> dict:
    """One headless Claude run. -> the CLI's JSON result.

    `should_stop()` is polled while Claude works, so a lost lease or a
    shutdown request kills the run instead of waiting out a long research.
    """
    tools = ["WebSearch", "WebFetch"] if kind == "research" else []
    cmd = [CLAUDE_BIN, "-p", "--output-format", "json", "--model", MODEL,
           "--system-prompt", system, "--strict-mcp-config", "--no-session-persistence",
           "--tools", *(tools or [""])]
    if tools:
        cmd += ["--allowedTools", *tools]
    timeout = TIMEOUT_SECONDS[kind]
    with tempfile.TemporaryDirectory(prefix=f"ytm-{kind}-") as cwd:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.close()
        t0 = time.monotonic()
        while proc.poll() is None:
            if should_stop is not None:
                try:
                    should_stop()
                except BaseException:
                    proc.kill()
                    proc.wait()
                    raise
            if time.monotonic() - t0 > timeout:
                proc.kill()
                proc.wait()
                raise TimeoutError(f"claude -p gave no answer in {timeout // 60} minutes")
            time.sleep(1.0)
        out, err = proc.stdout.read() if proc.stdout else "", proc.stderr.read() if proc.stderr else ""
    result = parse_result(out, err, proc.returncode)
    log(f"  claude: {result.get('num_turns')} turns, {result.get('duration_ms', 0) / 1000:.0f}s, "
        f"${result.get('total_cost_usd', 0):.2f} equivalent")
    return result


def parse_result(out: str, err: str, returncode: int | None) -> dict:
    """The CLI's `--output-format json` result, or the reason there is none.
    Claude declining (limit, sign-in) is a `WriterGate`: retrying soon repeats it."""
    try:
        result = json.loads(out)
    except json.JSONDecodeError:
        tail = (err or out).strip()[-600:]
        if re.search(r"limit|quota|rate|log ?in|auth|credit", tail, re.I):
            raise WriterGate(f"Claude did not run: {tail}") from None
        raise RuntimeError(f"claude -p exited {returncode} without a result: {tail}") from None
    if result.get("is_error"):
        message = str(result.get("result") or result.get("subtype") or "unknown error")
        status = result.get("api_error_status")
        if status in (401, 403, 429) or re.search(r"limit|quota|log ?in|auth", message, re.I):
            raise WriterGate(f"Claude did not run: {message}")
        raise RuntimeError(f"claude -p reported an error ({status}): {message[:600]}")
    return result


def write(kind: str, project: dict, *, research_md: str | None = None, note: str | None = None,
          narrative_id: str | None = None, should_stop=None, log=print) -> Written:
    if narrative_id:
        # The job's own choice, pinned at enqueue: a change to the film's
        # narrative afterwards must not alter a script already being written.
        project = project | {"narrative": narrative_id}
    if kind == "research":
        system, prompt = research_prompt(project, note)
    else:
        if not research_md:
            raise WriterGate("there is no approved research to write the script from")
        system, prompt = script_prompt(project, research_md, note)
    result = run_claude(system, prompt, kind=kind, should_stop=should_stop, log=log)
    text = str(result.get("result") or "")
    return Written(
        markdown=extract_document(text), prompt=prompt, system=system,
        response_raw=json.dumps(result),
        meta={k: result.get(k) for k in ("session_id", "num_turns", "duration_ms",
                                          "total_cost_usd", "modelUsage")}
        | {"model": MODEL, "prompt_sha": text_sha(system + "\n" + prompt)},
    )
