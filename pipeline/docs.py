"""Parsing and validation for `research.md` and `script.md`.

These are the two human-reviewed artifacts, and the validators here are the
grounding contract from DESIGN.md made executable. Phase 1 has no UI to render
them in, but the rules belong next to the parser rather than being invented
twice — once now for the CLI and again in Phase 3 for the scripting screen.

Format note: the file as a whole is not YAML, but each beat body *is* a valid
YAML mapping, so beats are split by their `###` heading and the body handed to
`yaml.safe_load`. That keeps `narration: |` block scalars working for free and
means a malformed beat produces a YAML error pointing at the beat, instead of a
bespoke parser silently accepting half of it.

A validator that cannot be overruled gets worked around. DESIGN.md calls for a
**promote anyway** override in the UI; the CLI equivalent is `--force`, which
prints what it is overriding rather than suppressing it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

#: DESIGN.md puts estimated duration within +/-25% of target.
WPM = 150
DURATION_TOLERANCE = 0.25

BEAT_ID = re.compile(r"^B\d\d$")
CLAIM_ID = re.compile(r"^c\d+$")
HEADING = re.compile(r"^###\s+(?P<id>\S+)\s*(?:[-—]+\s*(?P<title>.*))?$")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)

#: The cheap heuristic DESIGN.md asks for: a beat claiming to be pure
#: atmosphere while asserting a number, a date or a proper noun is the
#: dangerous case, because `tone: true` is how a beat opts out of citing.
ASSERTS_FACT = re.compile(r"\b(?:\d{3,}|\d+(?:st|nd|rd|th)|[A-Z][a-z]{3,})\b")

#: Where a sentence starts: a capital there is grammar, not a proper noun.
SENTENCE_START = re.compile(r"(?:^|[.!?]\s+|[\u201c\"']\s*)$")


#: Architecture in the period line. Measured: "the fort at Vindolanda behind
#: Hadrian's Wall" put a crenellated stone castle behind the protagonist in all
#: three candidate looks; "Roman Britain, about AD 100, the northern frontier"
#: on the same seed did not.
PERIOD_ARCHITECTURE = r"\b(forts?|fortress|castle|walls?|towers?|abbey|cathedral|palace|city walls)\b"


def fact_markers(text: str) -> list[str]:
    """Numbers, ordinals and capitalised words that are not sentence-initial.

    Measured on the first real Claude script: a purely atmospheric opening
    ("Rain on stone. Wind off the moor...") was flagged for "Rain", "Wind" and
    "Behind", every one the first word of its sentence. A warning that fires
    on correct beats teaches people to skip warnings.
    """
    hits = []
    for m in ASSERTS_FACT.finditer(text):
        word = m.group(0)
        if word[0].isupper() and SENTENCE_START.search(text[: m.start()]):
            continue
        hits.append(word)
    return hits


#: Sentinel used by the Phase 1 fixtures. Never valid without an explicit flag,
#: so a hand-written fixture cannot be mistaken for researched output.
FIXTURE_SOURCE = "FIXTURE"


@dataclass
class Report:
    """What DESIGN.md stores as `validator_report`."""

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def render(self) -> str:
        lines = [f"  ERROR  {e}" for e in self.errors]
        lines += [f"  warn   {w}" for w in self.warnings]
        return "\n".join(lines) or "  (clean)"


@dataclass
class Beat:
    beat_id: str
    title: str
    narration: str
    visual: str
    mood: str
    cites: list[str] = field(default_factory=list)
    tone: bool = False

    @property
    def words(self) -> list[str]:
        return self.narration.split()


@dataclass
class Claim:
    claim_id: str
    claim: str
    source: str


@dataclass
class Research:
    meta: dict
    claims: dict[str, Claim]
    raw: str


@dataclass
class Script:
    meta: dict
    beats: list[Beat]
    raw: str

    @property
    def narration(self) -> str:
        """The full narration, in beat order.

        This exact string is what gets spoken, aligned and ASR-checked. One
        source for all three or the timestamps describe audio nobody generated.
        """
        return " ".join(b.narration for b in self.beats)

    @property
    def target_duration(self) -> float:
        return float(self.meta.get("target_duration", 0) or 0)


# ------------------------------------------------------------------ splitting


def _split_frontmatter(text: str) -> tuple[dict, str]:
    text = HTML_COMMENT.sub("", text)
    if not text.lstrip().startswith("---"):
        return {}, text
    body = text.lstrip()
    _, fm, rest = body.split("---", 2)
    return yaml.safe_load(fm) or {}, rest


def _split_sections(body: str) -> list[tuple[str, str, str]]:
    """-> [(id, title, yaml_body)] for every `### <id> - <title>` heading."""
    out: list[tuple[str, str, str]] = []
    current: tuple[str, str] | None = None
    buf: list[str] = []
    for line in body.splitlines():
        m = HEADING.match(line.strip())
        if m:
            if current:
                out.append((current[0], current[1], "\n".join(buf)))
            current = (m.group("id"), (m.group("title") or "").strip())
            buf = []
        elif current:
            buf.append(line)
    if current:
        out.append((current[0], current[1], "\n".join(buf)))
    return out


def _load_body(section_id: str, raw: str, kind: str) -> dict:
    try:
        parsed = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise RuntimeError(f"{kind} {section_id}: body is not valid YAML: {exc}") from exc
    if parsed is None:
        return {}
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{kind} {section_id}: body parsed as {type(parsed).__name__}, want a mapping")
    return parsed


# -------------------------------------------------------------------- loaders


def parse_research(path: Path) -> Research:
    return parse_research_text(path.read_text())


def parse_research_text(text: str) -> Research:
    """The same parse over text already in memory — an `artifacts` row."""
    meta, body = _split_frontmatter(text)
    claims: dict[str, Claim] = {}
    for cid, _title, raw in _split_sections(body):
        d = _load_body(cid, raw, "claim")
        claims[cid] = Claim(
            claim_id=cid,
            claim=str(d.get("claim", "")).strip(),
            source=str(d.get("source", "")).strip(),
        )
    return Research(meta=meta, claims=claims, raw=text)


def parse_script(path: Path) -> Script:
    return parse_script_text(path.read_text())


def parse_script_text(text: str) -> Script:
    meta, body = _split_frontmatter(text)
    beats: list[Beat] = []
    for bid, title, raw in _split_sections(body):
        d = _load_body(bid, raw, "beat")
        cites = d.get("cites") or []
        if isinstance(cites, str):
            cites = [c.strip() for c in cites.split(",") if c.strip()]
        beats.append(
            Beat(
                beat_id=bid,
                title=title,
                # TTS and the aligner both want one flat line per beat; the
                # block scalar's newlines are layout, not pauses.
                narration=" ".join(str(d.get("narration", "")).split()),
                visual=str(d.get("visual", "")).strip(),
                mood=str(d.get("mood", "")).strip(),
                cites=[str(c) for c in cites],
                tone=bool(d.get("tone", False)),
            )
        )
    return Script(meta=meta, beats=beats, raw=text)


def protagonist(script: "Script") -> tuple[str, str] | None:
    """(name as the visuals use it, period-accurate description) from front matter."""
    name = str(script.meta.get("protagonist") or "").strip()
    look = str(script.meta.get("protagonist_look") or "").strip()
    return (name, look) if name and look else None


# ----------------------------------------------------------------- validators


def validate_research(res: Research, *, allow_fixture_sources: bool = False) -> Report:
    r = Report()
    if not res.claims:
        r.errors.append("research.md declares no claims")
    for cid, claim in res.claims.items():
        if not CLAIM_ID.match(cid):
            r.errors.append(f"claim id {cid!r} does not match c<digits>")
        if not claim.claim:
            r.errors.append(f"{cid}: empty `claim`")
        if not claim.source:
            r.errors.append(f"{cid}: no `source`")
        elif claim.source == FIXTURE_SOURCE:
            if allow_fixture_sources:
                r.warnings.append(f"{cid}: fixture source, not researched or cited")
            else:
                r.errors.append(
                    f"{cid}: source is the {FIXTURE_SOURCE} sentinel; "
                    "pass --allow-fixture-sources to run the slice on hand-written claims"
                )
        elif not claim.source.startswith(("http://", "https://")):
            r.errors.append(f"{cid}: source {claim.source!r} is not a URL")
    return r


def validate_script(script: Script, research: Research | None = None) -> Report:
    """The rules in DESIGN.md, in the order they appear there."""
    r = Report()
    if not script.beats:
        r.errors.append("script.md declares no beats")
        return r

    who = protagonist(script)
    seen: set[str] = set()
    for i, b in enumerate(script.beats):
        if not BEAT_ID.match(b.beat_id):
            r.errors.append(f"beat id {b.beat_id!r} does not match B<dd>")
        if b.beat_id in seen:
            r.errors.append(f"beat id {b.beat_id!r} is duplicated")
        seen.add(b.beat_id)

        for fname in ("narration", "visual", "mood"):
            if not getattr(b, fname):
                r.errors.append(f"{b.beat_id}: missing `{fname}`")

        if not b.cites and not b.tone:
            r.errors.append(
                f"{b.beat_id}: no `cites` and not marked `tone: true` — "
                "every beat either grounds a claim or asserts no fact"
            )
        if b.cites and b.tone:
            r.warnings.append(f"{b.beat_id}: has both `cites` and `tone: true`")

        if b.tone:
            # The protagonist's name is the storyteller's device, not a fact:
            # a story-told script names them in its atmosphere beats.
            hits = sorted(set(fact_markers(b.narration)) - ({who[0]} if who else set()))
            if hits:
                r.warnings.append(
                    f"{b.beat_id}: `tone: true` but narration asserts {hits[:4]} — "
                    "an atmosphere beat should not carry facts"
                )

        if research is not None:
            for cid in b.cites:
                if cid not in research.claims:
                    r.errors.append(f"{b.beat_id}: cites {cid!r}, which is not in research.md")

    ids = [b.beat_id for b in script.beats if BEAT_ID.match(b.beat_id)]
    if ids != sorted(ids):
        r.errors.append(f"beat ids are out of order: {ids}")

    if who is None:
        r.warnings.append(
            "front matter has no `protagonist` and `protagonist_look`: every shot is painted with one "
            "reference character, and without a written description of their period clothing the model "
            "dresses them from the wrong century")
    elif not any(re.search(rf"\b{re.escape(who[0])}\b", b.visual) for b in script.beats):
        r.warnings.append(f"no beat's `visual` names the protagonist {who[0]!r}")

    period = str(script.meta.get("period") or "")
    built = sorted(set(re.findall(PERIOD_ARCHITECTURE, period, re.I)))
    if built:
        r.warnings.append(
            f"`period` names {', '.join(built)}: it is added to every image prompt, and the painter turns "
            "forts and walls into medieval stone castles in every shot. Keep it to era and region.")

    if not str(script.meta.get("period") or "").strip():
        r.warnings.append(
            "front matter has no `period`: images get no place-and-time anchor, and the model "
            "fills in its own (a brimmed hat and 19th-century work clothes for 'a soldier')")

    target = script.target_duration
    if target <= 0:
        r.errors.append("frontmatter has no positive `target_duration`")
    else:
        words = len(script.narration.split())
        est = words / WPM * 60
        low, high = target * (1 - DURATION_TOLERANCE), target * (1 + DURATION_TOLERANCE)
        if not low <= est <= high:
            r.errors.append(
                f"estimated duration {est:.1f}s ({words} words at {WPM} wpm) is outside "
                f"{low:.0f}-{high:.0f}s for target_duration {target:.0f}s"
            )
    return r


# ------------------------------------------------------------ one entry point


#: A source that answers with one of these does not exist: most likely a URL
#: that was constructed rather than read. An error, overridable like any other.
GONE = {404, 410}

#: Sites that block robots (401/403/429) or are briefly down cannot be
#: confirmed either way; that is a warning, not an error.
SOURCE_TIMEOUT = 8.0
SOURCE_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")


def probe_source(url: str, timeout: float = SOURCE_TIMEOUT) -> tuple[int | None, str]:
    """-> (HTTP status or None, problem). HEAD first, GET if HEAD is refused."""
    import urllib.error
    import urllib.request

    last = ""
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={
            "User-Agent": SOURCE_AGENT, "Accept": "text/html,*/*;q=0.8", "Range": "bytes=0-2047"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, ""
        except urllib.error.HTTPError as exc:
            if exc.code in GONE or method == "GET":
                return exc.code, f"HTTP {exc.code}"
            last = f"HTTP {exc.code}"          # HEAD refused: try GET
        except urllib.error.URLError as exc:
            reason = str(getattr(exc, "reason", exc))
            if "nodename" in reason or "Name or service" in reason or "getaddrinfo" in reason:
                return None, "no such host"
            last = reason
        except Exception as exc:               # timeouts, TLS, resets
            last = f"{type(exc).__name__}: {exc}"
    return None, last


def check_sources(res: Research, report: Report, *, workers: int = 8) -> int:
    """Ask every cited page whether it exists. Adds to `report` in place.
    -> how many distinct pages were asked."""
    from concurrent.futures import ThreadPoolExecutor

    by_url: dict[str, list[str]] = {}
    for cid, claim in res.claims.items():
        if claim.source.startswith(("http://", "https://")):
            by_url.setdefault(claim.source, []).append(cid)
    if not by_url:
        return 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(zip(by_url, pool.map(probe_source, by_url)))
    for url, (status, problem) in results.items():
        cids = ", ".join(by_url[url])
        if status in GONE or problem == "no such host":
            report.errors.append(f"{cids}: source does not exist ({problem}): {url}")
        elif status is None or status >= 400:
            report.warnings.append(f"{cids}: could not confirm the source ({problem}): {url}")
    return len(by_url)


def check(kind: str, markdown: str, *, research_markdown: str | None = None,
          allow_fixture_sources: bool = False, verify_sources: bool = False) -> dict:
    """Parse and validate one document, never raising. -> the slot's verdict.

    This is the only way a document enters a slot. A human paste goes through
    the web app's validator function and a `claude -p` generation goes through
    the worker, and both call this, so nothing downstream can tell which mode
    filled the slot (DESIGN.md "Slot filling is mode-agnostic").

    `verify_sources` asks every cited page whether it exists (network; off in
    tests). A page that is gone is an error, one that blocks robots a warning.

    A document that does not parse is `invalid` with the parse error as its
    only error, rather than an exception: the UI renders it inline next to the
    text the way it renders any other validator failure.
    """
    if kind not in ("research", "script"):
        raise ValueError(f"unknown document kind {kind!r}")
    checked: int | None = None
    try:
        if kind == "research":
            doc = parse_research_text(markdown)
            report = validate_research(doc, allow_fixture_sources=allow_fixture_sources)
            if verify_sources:
                checked = check_sources(doc, report)
            parsed = {"meta": doc.meta, "claims": [
                {"id": c.claim_id, "claim": c.claim, "source": c.source}
                for c in doc.claims.values()]}
        else:
            research = parse_research_text(research_markdown) if research_markdown else None
            doc = parse_script_text(markdown)
            report = validate_script(doc, research)
            if research is None:
                report.warnings.append("no approved research.md to check `cites` against")
            parsed = {"meta": doc.meta, "beats": [
                {"id": b.beat_id, "title": b.title, "narration": b.narration, "visual": b.visual,
                 "mood": b.mood, "cites": b.cites, "tone": b.tone}
                for b in doc.beats]}
    except Exception as exc:  # malformed front matter, YAML, a non-mapping body
        return {"doc_status": "invalid", "errors": [f"could not parse {kind}.md: {exc}"],
                "warnings": [], "parsed": None}
    return {"doc_status": "valid" if report.ok else "invalid", "errors": report.errors,
            "warnings": report.warnings, "parsed": _plain(parsed), "sources_checked": checked}


def _plain(o):
    """YAML front matter can hold dates; the verdict must be JSON."""
    if isinstance(o, dict):
        return {str(k): _plain(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_plain(v) for v in o]
    if isinstance(o, (str, int, float, bool)) or o is None:
        return o
    return str(o)
