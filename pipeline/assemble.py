"""ffmpeg assembly: stills -> Ken Burns segments -> cross-dissolved film.

Raw ffmpeg, not MoviePy (PLAN.md section 9). Two stages, and the split is the
whole point:

1. **Each shot renders to its own short mp4, keyed by content hash.** This is
   the segment-level render cache from PLAN.md section 4. One edited shot costs
   one segment re-render plus a stitch, which is what makes the Phase 4 editing
   page feel instant instead of re-rendering the film.
2. **A single stitch pass cross-dissolves the segments and muxes the audio.**

### The sync trap in stage 2, and the arithmetic that avoids it

`xfade` consumes its transition time from the *output*: dissolving n clips with
a transition of t removes (n-1)*t from the total. Rendering each segment at its
shot duration and then cross-dissolving would produce a film 3.6s shorter than
its own narration, with everything after the first shot progressively early.
That is a silent desync of exactly the kind this pipeline is built to prevent,
and it would look fine in every individual segment.

So the compensation is explicit. For `xfade(A, B, duration=t, offset=o)`, B is
placed at output time `o` and the result runs `o + len(B)`. Therefore:

    segment i is rendered at  shot_i.duration + t     (an extra tail)
    transition i is placed at offset  start_{i+1} - t

Each shot becomes fully visible exactly at its own `start`, the dissolve occupies
the final t seconds of the outgoing shot, and the total comes to `sum(durations)`
— the audio length, exactly. The assertion at the end of `stitch` checks the
rendered file against the timeline rather than trusting this comment.

Audio is explicitly padded and trimmed to the timeline duration rather than
left to `-shortest`, because failure mode 11 is an audio/video length mismatch
and `-shortest` resolves it silently in whichever direction happens to apply.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from . import config
from .timeline import Shot, Timeline, sha


def _run(cmd: list[str], what: str) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-12:]
        raise RuntimeError(f"{what} failed:\n  " + "\n  ".join(tail))
    return proc.stdout


def preflight() -> tuple[bool, str]:
    if not shutil.which("ffmpeg"):
        return False, "ffmpeg not on PATH (brew install ffmpeg)"
    if not shutil.which("ffprobe"):
        return False, "ffprobe not on PATH"
    return True, "ok"


def probe_duration(path: Path) -> float:
    out = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        f"ffprobe {path.name}",
    )
    return float(json.loads(out)["format"]["duration"])


def _kenburns(shot: Shot, render: dict) -> str:
    """The filter chain for one still: upscale, fill the frame, pan and zoom.

    The still is 832x480 (1.733:1) and the frame is 16:9, so it is scaled to
    *cover* and centre-cropped rather than padded — a pillarboxed shot inside a
    Ken Burns move looks like a bug. The upscale before `zoompan` is what gives
    the zoom real pixels to work with; zooming a 832x480 still straight to
    1080p interpolates the whole way.
    """
    w, h, fps = render["width"], render["height"], render["fps"]
    up = config.KENBURNS_UPSCALE
    big_w, big_h = int(w * up) // 2 * 2, int(h * up) // 2 * 2
    frames = max(1, int(round(shot.rendered_duration * fps)))
    z = shot.motion.zoom_amount

    if shot.motion.zoom == "in":
        zoom_expr = f"1+{z}*on/{frames}"
    else:
        zoom_expr = f"{1 + z}-{z}*on/{frames}"

    # zoompan's x/y are top-left in input pixels, where iw/ih are the *scaled*
    # input and zoom is the current factor. Centre is (iw-iw/zoom)/2.
    cx, cy = f"(iw-iw/zoom)/2", f"(ih-ih/zoom)/2"
    travel = 0.5 * z
    pan = shot.motion.pan
    if pan == "right":
        x, y = f"{cx}+(iw*{travel})*(on/{frames}-0.5)", cy
    elif pan == "left":
        x, y = f"{cx}-(iw*{travel})*(on/{frames}-0.5)", cy
    elif pan == "down":
        x, y = cx, f"{cy}+(ih*{travel})*(on/{frames}-0.5)"
    elif pan == "up":
        x, y = cx, f"{cy}-(ih*{travel})*(on/{frames}-0.5)"
    else:
        x, y = cx, cy

    return (
        f"scale={big_w}:{big_h}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={big_w}:{big_h},"
        f"zoompan=z='{zoom_expr}':x='{x}':y='{y}':d={frames}:s={w}x{h}:fps={fps},"
        f"format=yuv420p,setsar=1"
    )


def segment_hash(shot: Shot, render: dict) -> str:
    """Content address for a rendered segment.

    Keyed on the image, the move, the rendered length and the render settings —
    everything that changes the bytes. A mood edit that changes the image
    invalidates the segment; a title change does not.
    """
    return sha(
        "seg-v1",
        shot.image.hash if shot.image else None,
        shot.motion.kind, shot.motion.zoom, shot.motion.pan, shot.motion.zoom_amount,
        round(shot.rendered_duration, 4),
        render["width"], render["height"], render["fps"],
    )


def render_segments(timeline: Timeline, paths, *, log=print) -> list[Path]:
    """One short mp4 per shot, reused when the hash already exists."""
    out: list[Path] = []
    made = cached = 0

    for shot in timeline.shots:
        if shot.image is None:
            raise RuntimeError(f"{shot.shot_id} has no image; cannot render")
        h = segment_hash(shot, timeline.render)
        dest = paths.segments / f"{h}.mp4"

        if not (dest.exists() and dest.stat().st_size > 0):
            src = paths.root / shot.image.path
            _run(
                [
                    "ffmpeg", "-y", "-loop", "1", "-framerate", str(timeline.render["fps"]),
                    "-t", f"{shot.rendered_duration:.4f}", "-i", str(src),
                    "-vf", _kenburns(shot, timeline.render),
                    "-frames:v", str(max(1, int(round(shot.rendered_duration * timeline.render["fps"])))),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "17",
                    "-pix_fmt", "yuv420p", "-an", str(dest),
                ],
                f"segment {shot.shot_id}",
            )
            made += 1
            tag = f"rendered {probe_duration(dest):.2f}s"
        else:
            cached += 1
            tag = "cached"

        shot.segment = {
            "hash": h,
            "path": str(dest.relative_to(paths.root)),
            "rendered_duration": round(shot.rendered_duration, 4),
        }
        log(f"  {shot.shot_id}  {shot.duration:5.2f}s visible  "
            f"{shot.rendered_duration:5.2f}s rendered  {shot.motion.zoom}/{shot.motion.pan:<5}  {tag}")
        out.append(dest)

    log(f"  {made} rendered, {cached} cached")
    return out


def stitch(timeline: Timeline, segments: list[Path], audio: Path, dest: Path, *, log=print) -> Path:
    """Cross-dissolve the segments, mux the narration, verify the length."""
    t = timeline.render["xfade"]
    fps = timeline.render["fps"]
    duration = timeline.duration
    shots = timeline.shots

    inputs: list[str] = []
    for seg in segments:
        inputs += ["-i", str(seg)]
    inputs += ["-i", str(audio)]
    audio_index = len(segments)

    filters: list[str] = []
    # Normalize every segment the same way before any transition. xfade needs
    # matching format, fps and timebase, and a mismatch surfaces as a cryptic
    # error rather than a bad picture.
    for i in range(len(segments)):
        filters.append(f"[{i}:v]settb=AVTB,fps={fps},format=yuv420p,setsar=1[v{i}]")

    if len(segments) == 1:
        video_label = "v0"
    else:
        current = "v0"
        for i in range(1, len(segments)):
            # The dissolve occupies the final t seconds of the outgoing shot,
            # so shot i becomes fully visible exactly at its own start.
            offset = shots[i].start - t
            label = f"x{i}"
            filters.append(
                f"[{current}][v{i}]xfade=transition=fade:duration={t:.4f}:"
                f"offset={offset:.4f}[{label}]"
            )
            current = label
        video_label = current

    # Pad then trim to the exact timeline length, in that order: pad covers a
    # track that is short, trim covers one that is long, and doing both means
    # the output length is asserted rather than hoped for (failure mode 11).
    filters.append(
        f"[{audio_index}:a]apad,atrim=0:{duration:.4f},"
        f"asetpts=N/SR/TB,aresample=48000[aout]"
    )
    filters.append(f"[{video_label}]trim=0:{duration:.4f},setpts=PTS-STARTPTS[vout]")

    _run(
        ["ffmpeg", "-y", *inputs,
         "-filter_complex", ";".join(filters),
         "-map", "[vout]", "-map", "[aout]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(dest)],
        "stitch",
    )

    actual = probe_duration(dest)
    drift = actual - duration
    log(f"  {dest.name}  {actual:.2f}s (timeline {duration:.2f}s, drift {drift * 1000:+.0f}ms)")

    # One frame of slack. Anything larger means the xfade compensation is wrong
    # and every shot after the first is out of step with its narration.
    tolerance = 1.5 / fps
    if abs(drift) > tolerance:
        raise RuntimeError(
            f"rendered video is {actual:.3f}s but the timeline says {duration:.3f}s "
            f"({drift * 1000:+.0f}ms, tolerance {tolerance * 1000:.0f}ms). "
            "The cross-dissolve compensation is wrong — audio and image are out of sync."
        )
    return dest


def build(timeline: Timeline, paths, *, log=print) -> Path:
    ok, msg = preflight()
    if not ok:
        raise RuntimeError(msg)
    segments = render_segments(timeline, paths, log=log)
    return stitch(timeline, segments, paths.audio, paths.video, log=log)
