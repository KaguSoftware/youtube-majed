"""Captions: the narration's own words, burned into the picture.

They are timed from the same word-level alignment the shots are cut on, so
they are in sync for the same reason the pictures are: nothing is estimated.

Three decisions worth keeping:

**Burned in, drawn by Pillow.** Homebrew's ffmpeg has no drawtext, subtitles
or ass filter (no freetype, no libass), and ffmpeg is a pinned tool, so each
caption is drawn once as a transparent PNG and laid on with `overlay`, which
every build has. The font is vendored (Source Sans 3, OFL; `fonts/OFL.txt`)
so the worker and a laptop draw the same pixels.

**Captions are film-level, chunks cut them.** A caption runs across shot
boundaries like the voice does. Each chunk overlays the part of every caption
that falls in its frames (assemble.plan_chunks) and its hash includes them,
so an edit still re-encodes only the chunks it touched.

**The script's spelling, not the aligner's.** Aligned words are folded to
the acoustic model's alphabet ("ROME'S", no punctuation). Each word carries
`display`, the script token it came from, set when shots are planned; a
token the normaliser split in two ("half-starved") is displayed once, on its
first piece, and the rest carry "".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .timeline import file_sha, sha

FONT = Path(__file__).resolve().parent / "fonts" / "SourceSans3-Semibold.ttf"

#: In the chunk hash: change it when the look of a caption changes.
STYLE = "cap-v1"

#: One line, short enough to read at a glance over a painting.
MAX_CHARS = 38
#: Silence longer than this ends a caption: the voice has stopped.
PAUSE_BREAK = 0.55
#: A caption stays this long after its last word, unless the next one starts.
HOLD = 0.4
#: Gaps shorter than this between captions are closed, so nothing flickers.
BRIDGE = 0.35
#: Nothing shorter than this on screen, time permitting.
MIN_SECONDS = 0.8

#: Text size and position, as fractions of the frame height.
SIZE = 0.052
BOTTOM = 0.085

SENTENCE_END = re.compile(r"[.!?…]['\"”’)]*$")
CLAUSE_END = re.compile(r"[,;:—–]['\"”’)]*$")
#: A caption does not end on one of these when it can help it.
WEAK = {"a", "an", "the", "of", "to", "in", "on", "and", "or", "but", "for", "at", "by",
        "with", "from", "his", "her", "their", "its", "is", "was", "that"}


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str

    def frames(self, fps: int) -> tuple[int, int]:
        """[first, end) film frames this caption is on screen."""
        return round(self.start * fps), round(self.end * fps)


# ------------------------------------------------------------- spelling

def display_tokens(narration: str, n_words: int) -> list[str] | None:
    """The script token shown for each of a beat's `n_words` aligned words.

    Walks the tokens the way the aligner normalised them (as shots._candidates
    does). A token that normalises to nothing (a lone dash) is joined to the
    one before. None when the walk does not land on `n_words`: better no
    spelling than the wrong word under a voice."""
    from .align import normalize

    out: list[str] = []
    for token in narration.split():
        produced = len(normalize(token).split())
        if produced == 0:
            if out:
                last = next(i for i in range(len(out) - 1, -1, -1) if out[i])
                out[last] += " " + token
            continue
        out += [token] + [""] * (produced - 1)
    return out if len(out) == n_words else None


# ---------------------------------------------------------------- cues

def _tokens(shots) -> list[list]:
    """[text, start, end, beat_id] per spoken token, in film order."""
    out: list[list] = []
    for s in shots:
        for w in s.words:
            d = w.get("display")
            if d is None:
                d = w["word"].lower()
            if d == "" and out:
                out[-1][2] = w["end"]
            elif d:
                out.append([d, w["start"], w["end"], s.beat_id])
    return out


def _length(group: list[list]) -> int:
    return len(" ".join(t[0] for t in group))


def _break_point(group: list[list]) -> int:
    """Where an over-long caption should end: after its last clause mark if
    that leaves a real caption, else before a trailing weak word."""
    for k in range(len(group) - 2, -1, -1):
        if CLAUSE_END.search(group[k][0]) and _length(group[:k + 1]) >= 14:
            return k + 1
    k = len(group)
    while k > 2 and group[k - 1][0].lower().strip("\"'“‘") in WEAK:
        k -= 1
    return k


def cues(shots, duration: float) -> list[Cue]:
    """The film's captions: phrases of the narration with their times."""
    groups: list[list[list]] = []
    cur: list[list] = []
    for tok in _tokens(shots):
        if cur and (tok[1] - cur[-1][2] > PAUSE_BREAK or tok[3] != cur[-1][3]):
            groups.append(cur)
            cur = []
        cur.append(tok)
        if len(cur) > 1 and _length(cur) > MAX_CHARS:
            k = _break_point(cur[:-1])
            groups.append(cur[:k])
            cur = cur[k:]
        if SENTENCE_END.search(tok[0]) or (CLAUSE_END.search(tok[0]) and _length(cur) >= MAX_CHARS * 0.6):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)

    out: list[Cue] = []
    for i, g in enumerate(groups):
        start = g[0][1]
        nxt = groups[i + 1][0][1] if i + 1 < len(groups) else duration
        end = min(max(g[-1][2] + HOLD, start + MIN_SECONDS), nxt)
        if nxt - end < BRIDGE:
            end = nxt
        out.append(Cue(start=round(start, 4), end=round(end, 4), text=" ".join(t[0] for t in g)))
    return out


# -------------------------------------------------------------- drawing

@lru_cache(maxsize=1)
def _font_sha() -> str:
    return file_sha(FONT)


def image_key(text: str, render: dict) -> str:
    return sha(STYLE, text, render["width"], render["height"], _font_sha())


def overlay_position(render: dict) -> tuple[str, str]:
    """overlay's x and y: centred, its baseline area BOTTOM above the edge."""
    return "(main_w-overlay_w)/2", f"main_h-overlay_h-{round(render['height'] * BOTTOM)}"


def draw(text: str, render: dict, dest: Path) -> Path:
    """One caption as a transparent PNG: warm white, a thin dark edge and a
    soft shadow, which reads on bright skies and on near-black interiors."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    import os

    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    from . import config

    size = max(12, round(render["height"] * SIZE))
    font = ImageFont.truetype(str(FONT), size)
    stroke = max(1, round(size * 0.06))
    pad = round(size * 0.45)
    left, top, right, bottom = font.getbbox(text, stroke_width=stroke)
    w = (right - left + 2 * pad + 1) // 2 * 2
    h = (bottom - top + 2 * pad + 1) // 2 * 2
    origin = (pad - left, pad - top)

    shadow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shadow).text((origin[0], origin[1] + round(size * 0.06)), text, font=font,
                                fill=200, stroke_width=stroke * 2, stroke_fill=200)
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.14))
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.putalpha(shadow)
    ImageDraw.Draw(im).text(origin, text, font=font, fill=(246, 241, 230, 255),
                            stroke_width=stroke, stroke_fill=(12, 10, 8, 235))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = config.partial(dest)
    im.save(tmp, "PNG")
    os.replace(tmp, dest)
    return dest
