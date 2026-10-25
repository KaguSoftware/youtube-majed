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
            hits = sorted(set(ASSERTS_FACT.findall(b.narration)) - {"The", "This", "That", "And", "But", "Beyond"})
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
