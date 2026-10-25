"""Turning beats plus measured word timings into shots.

This is where the pipeline's central ordering pays off. Audio exists before any
image, so shot boundaries are *derived* from where words actually fall rather
than planned and then fixed up. Sync is structural: a shot cannot be out of
step with the narration because the narration is what defined it.

Three decisions worth keeping:

**The shot budget is distributed, not guessed per beat.** DESIGN.md says a beat
is one to three shots. Allocating a fixed total by largest-remainder over
measured beat durations hits the target count exactly while keeping long beats
richer than short ones. Rounding per beat would miss the target by two or three.

**Cuts land on clause boundaries, not on arithmetic.** A cut mid-clause reads
as a mistake. Candidate boundaries near the ideal split time are scored, and
following a full stop beats following a comma, which beats landing nowhere.

**A beat's multiple shots get different framings.** Two shots from one beat
would otherwise share a prompt, which means one image generated twice — the
near-duplicate failure (PLAN.md risk 2) arriving by construction rather than by
accident. The framing ladder is also just how a scene is actually covered.

Inter-beat silence belongs to the preceding shot. It is not spoken audio, so no
word can claim it, and leaving it unassigned would put a hole in the video.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import config
from .timeline import Motion

#: Framing ladders by shot count within a beat. Index 0 establishes the beat;
#: later entries move closer.
#:
#: These are deliberately *directive* about lens, distance and what fills the
#: frame, rather than the bare "wide shot" / "close shot" they started as. The
#: first Phase 1 run showed why: shots within a beat share `visual` and `mood`,
#: so the framing phrase is the only thing distinguishing their prompts, and a
#: two-word hint was not enough to move the composition. S03/S04 and S06/S07
#: both came back as effectively the same image. Rerolling on a new seed can
#: rescue that, but it is a lottery against a prompt that is asking for the
#: same picture twice; changing what is asked for is the actual fix.
FRAMINGS: dict[int, list[str | None]] = {
    1: [None],
    2: [
        "wide establishing shot, high vantage, figures small in a large space, deep background visible",
        "tight close-up, subject filling the frame, shallow depth of field, background dissolved",
    ],
    3: [
        "wide establishing shot, high vantage, figures small in a large space, deep background visible",
        "medium shot at eye level, waist up, background legible but soft",
        "extreme close-up on texture and hands, filling the frame, shallow depth of field",
    ],
}

#: Cut preference. A split *after* one of these scores better.
SENTENCE_END = re.compile(r"[.!?]['\")]?$")
CLAUSE_END = re.compile(r"[,;:]['\")]?$")

SENTENCE_BONUS = 2.5
CLAUSE_BONUS = 1.0


@dataclass
class _Candidate:
    """A possible cut, between normalized word i and i+1."""

    after_index: int
    time: float
    bonus: float


def allocate(durations: list[float], total: int) -> list[int]:
    """Spread `total` shots across beats by duration, largest remainder first.

    Clamped to DESIGN.md's one-to-three per beat, then corrected so the sum is
    exactly `total` — an allocator that is usually right is not useful, because
    the discrepancy only shows up as a shot count nobody asked for.
    """
    n = len(durations)
    lo, hi = config.MIN_SHOTS_PER_BEAT, config.MAX_SHOTS_PER_BEAT
    if not (n * lo <= total <= n * hi):
        raise RuntimeError(
            f"cannot split {n} beats into {total} shots within "
            f"{lo}-{hi} per beat (range {n * lo}-{n * hi})"
        )

    span = sum(durations) or 1.0
    exact = [d / span * total for d in durations]
    counts = [min(hi, max(lo, int(e))) for e in exact]
    remainders = sorted(range(n), key=lambda i: exact[i] - int(exact[i]), reverse=True)

    # Hand out or claw back in passes over the remainder order, one per beat
    # per pass. Filling the strongest claimant to its ceiling before moving on
    # would turn six equal beats into [1,3,1,1,1,3] instead of [2,2,2,2,1,1].
    def pass_over(order, step, limit):
        moved = False
        for i in order:
            if sum(counts) == total:
                break
            if (counts[i] + step) * step <= limit * step:
                counts[i] += step
                moved = True
        return moved

    while sum(counts) < total:
        if not pass_over(remainders, +1, hi):
            raise RuntimeError("allocation stuck: every beat is at the maximum")
    while sum(counts) > total:
        if not pass_over(list(reversed(remainders)), -1, lo):
            raise RuntimeError("allocation stuck: every beat is at the minimum")
    return counts


def _candidates(beat_text: str, words) -> list[_Candidate]:
    """Score every inter-word position in a beat as a possible cut.

    `words` carry normalized text, so punctuation has to come from the original
    narration. Original tokens are walked alongside, and a token's trailing
    punctuation is attributed to the last normalized word it produced — which
    is what keeps a hyphenated token from shifting the mapping.
    """
    from .align import normalize

    bonuses: list[float] = []
    for token in beat_text.split():
        produced = len(normalize(token).split())
        if produced == 0:
            continue
        bonus = 0.0
        if SENTENCE_END.search(token):
            bonus = SENTENCE_BONUS
        elif CLAUSE_END.search(token):
            bonus = CLAUSE_BONUS
        bonuses.extend([0.0] * (produced - 1) + [bonus])

    if len(bonuses) != len(words):
        # Mapping failed, so fall back to timing alone rather than silently
        # attributing punctuation to the wrong words.
        bonuses = [0.0] * len(words)

    return [
        _Candidate(after_index=i, time=words[i].end, bonus=bonuses[i])
        for i in range(len(words) - 1)
    ]


def _split_beat(beat_text: str, words, n_shots: int, start: float, end: float) -> list[tuple[float, float, int, int]]:
    """-> [(start, end, first_word, last_word)] for each shot in the beat."""
    if n_shots <= 1 or len(words) < 2:
        return [(start, end, 0, len(words) - 1)]

    cands = _candidates(beat_text, words)
    chosen: list[_Candidate] = []
    span = end - start

    for k in range(1, n_shots):
        ideal = start + span * k / n_shots
        # Score by closeness to the ideal time, with a bonus for cutting at a
        # real boundary. The window scales with shot length so the bonus can
        # actually move the cut without letting it wander into another clause.
        window = max(1.0, span / n_shots * 0.45)
        best = None
        best_score = -1e9
        for c in cands:
            if c in chosen:
                continue
            distance = abs(c.time - ideal)
            if distance > window:
                continue
            # Never cut so close to an existing cut that a sliver shot results.
            if any(abs(c.time - x.time) < config.MIN_SHOT_SECONDS for x in chosen):
                continue
            score = c.bonus - distance / window
            if score > best_score:
                best, best_score = c, score
        if best is None:
            # No candidate in the window: fall back to the nearest unused cut,
            # which is still a word boundary and so still safe.
            remaining = [c for c in cands if c not in chosen]
            if not remaining:
                break
            best = min(remaining, key=lambda c: abs(c.time - ideal))
        chosen.append(best)

    chosen.sort(key=lambda c: c.after_index)

    out: list[tuple[float, float, int, int]] = []
    cursor_time, cursor_word = start, 0
    for c in chosen:
        out.append((cursor_time, c.time, cursor_word, c.after_index))
        cursor_time, cursor_word = c.time, c.after_index + 1
    out.append((cursor_time, end, cursor_word, len(words) - 1))
    return out


def _motion(index: int) -> Motion:
    """Deterministic Ken Burns variation.

    Alternating the move keeps ten stills from feeling like one slow drift, and
    deriving it from the index rather than randomly means a re-render produces
    the same film.
    """
    zoom = "in" if index % 2 == 0 else "out"
    pan = ("right", "up", "left", "down")[index % 4]
    return Motion(kind="kenburns", zoom=zoom, pan=pan, zoom_amount=config.KENBURNS_ZOOM)


def plan(
    beats,
    alignment,
    style,
    *,
    target_shots: int = config.TARGET_SHOTS,
    audio_duration: float | None = None,
    log=print,
):
    """-> list[Shot] tiling the audio contiguously from 0 to the audio end."""
    from .timeline import Shot

    by_id = {b.beat_id: b for b in alignment.beats}
    missing = [b.beat_id for b in beats if b.beat_id not in by_id]
    if missing:
        raise RuntimeError(f"no alignment for beats {missing}")

    durations = [by_id[b.beat_id].end - by_id[b.beat_id].start for b in beats]
    counts = allocate(durations, target_shots)
    log(f"  shot budget {target_shots} over {len(beats)} beats: "
        + ", ".join(f"{b.beat_id}:{c}" for b, c in zip(beats, counts)))

    shots: list[Shot] = []
    for beat, n in zip(beats, counts):
        ba = by_id[beat.beat_id]
        pieces = _split_beat(beat.narration, ba.words, n, ba.start, ba.end)
        ladder = FRAMINGS.get(len(pieces), FRAMINGS[3])

        for k, (s_start, s_end, w_lo, w_hi) in enumerate(pieces):
            framing = ladder[k] if k < len(ladder) else f"detail shot {k + 1}"
            words = ba.words[w_lo : w_hi + 1]
            index = len(shots)
            shots.append(
                Shot(
                    index=index,
                    shot_id=f"S{index + 1:02d}",
                    beat_id=beat.beat_id,
                    start=s_start,
                    end=s_end,
                    text=" ".join(w.word for w in words),
                    visual=beat.visual,
                    mood=beat.mood,
                    framing=framing,
                    cites=list(beat.cites),
                    prompt=style.prompt_for(beat.visual, beat.mood, framing),
                    seed=style.seed,
                    motion=_motion(index),
                    words=[
                        {"word": w.word, "start": round(w.start, 4),
                         "end": round(w.end, 4), "score": round(w.score, 4)}
                        for w in words
                    ],
                )
            )

    # Close the gaps. Inter-beat silence and the audio's trailing tail are not
    # owned by any word, so the preceding shot absorbs them and the last shot
    # runs to the true end of the audio. Without this the video has holes and
    # ends before the narration does.
    for a, b in zip(shots, shots[1:]):
        a.end = b.start
    shots[0].start = 0.0
    shots[-1].end = audio_duration if audio_duration is not None else alignment.audio_duration

    for s in shots:
        # The framing phrases are long by design; the log wants the shape of
        # the plan, not the prompt text, which is on the timeline in full.
        framing = (s.framing or "single").split(",")[0]
        log(f"  {s.shot_id}  {s.beat_id}  {s.start:6.2f}-{s.end:6.2f}s  "
            f"{s.duration:5.2f}s  {framing:<26} {s.text[:40].lower()}")
    return shots
