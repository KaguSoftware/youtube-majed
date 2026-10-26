"""ffmpeg assembly: stills -> Ken Burns segments -> film chunks -> film.

Raw ffmpeg, not MoviePy (PLAN.md section 9). Three stages, and the splits are
the whole point:

1. **Each shot renders to its own Ken Burns segment, keyed by content hash.**
   The segment-level render cache from PLAN.md section 4.
2. **Each shot's stretch of the finished film encodes to its own chunk**, also
   content-addressed: shot i's segment with the dissolve into shot i+1 at its
   tail. The chunks are the delivered video. The browser plays them in order as
   HLS beside one narration stream, so an edit to one shot re-encodes two
   chunks (the shot's and the one dissolving into it) and uploads only those.
   Measured on the 6-minute Roman film: re-encoding the whole film took 105 s,
   one chunk takes 2 s (PLAN.md 12.2). That is the difference between the
   Phase 4 exit (a corrected film in under 60 s) and not.
3. **The mp4 is the chunks concatenated by stream copy**, plus the narration
   encoded once: under 3 s, no re-encode. Built for a download and for the
   sync check, never needed for playback.

### The dissolve, in whole frames

A cut is a dissolve of t seconds (X = t * fps frames, 12 at 30 fps) that
occupies the final X frames of the outgoing shot, so each shot becomes fully
visible exactly at its own `start`. Everything is placed in integer frames,
with shot i starting at film frame F_i = round(start_i * fps):

    segment i is rendered at  shot_i.duration + t   (its first X frames are
                                                     the dissolve into it)
    chunk i is film frames    [F_i, F_{i+1})
                     drawn as segment i from frame X (frame 0 for the first
                     shot), dissolving into segment i+1's first X frames
                     over its own last X frames

So the chunks tile the film with no gaps and sum to round(duration * fps)
frames, the narration's length. The first version of this file stitched the
whole film with ffmpeg's `xfade` at fractional offsets, and the trap it avoided
still applies: xfade consumes its transition from the output, so dissolving
segments rendered at their visible length would have ended the film 3.6 s
early with every shot progressively ahead of its words. The extra tail on each
segment is that compensation, and `film` asserts the result's length against
the timeline rather than trusting this comment.

### Timestamps

HLS players place each chunk by its own timestamps, so every chunk carries its
film time plus `TS_BASE`, with ffmpeg's automatic shifting turned off. Left
on, the muxer offsets each stream by its own start delay, and the video
landed 45-67 ms after the narration it belongs to (B-frame reorder delay on
one side, AAC priming on the other; measured). With a fixed base, the first
frame of chunk i is presented at exactly TS_BASE + F_i / fps and the first
narration sample at TS_BASE.

Audio is explicitly padded and trimmed to the timeline duration rather than
left to `-shortest`, because failure mode 11 is an audio/video length mismatch
and `-shortest` resolves it silently in whichever direction happens to apply.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from . import config
from .timeline import Shot, Timeline, file_sha, sha


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


def render_segments(timeline: Timeline, paths, *, only: set[int] | None = None,
                    log=print) -> list[Path]:
    """One short mp4 per shot, reused when the hash already exists.

    Every shot's `segment` record is filled in; `only` (shot indexes) limits
    which ones are actually rendered when missing. An edit needs just the
    segments its new chunks are cut from, and on a machine that did not make
    the film the rest are not on disk at all."""
    out: list[Path] = []
    made = cached = 0

    for shot in timeline.shots:
        if shot.image is None:
            raise RuntimeError(f"{shot.shot_id} has no image; cannot render")
        h = segment_hash(shot, timeline.render)
        dest = paths.segments / f"{h}.mp4"
        shot.segment = {
            "hash": h,
            "path": str(dest.relative_to(paths.root)),
            "rendered_duration": round(shot.rendered_duration, 4),
        }
        out.append(dest)
        if only is not None and shot.index not in only:
            continue

        if not (dest.exists() and dest.stat().st_size > 0):
            # Through the mirror, so a still another machine made is fetched.
            paths.mirror.ensure(paths.root / shot.image.path)
            src = paths.root / shot.image.path
            _run(
                [
                    "ffmpeg", "-y", "-loop", "1", "-framerate", str(timeline.render["fps"]),
                    "-t", f"{shot.rendered_duration:.4f}", "-i", str(src),
                    "-vf", _kenburns(shot, timeline.render),
                    "-frames:v", str(max(1, int(round(shot.rendered_duration * timeline.render["fps"])))),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "17",
                    "-pix_fmt", "yuv420p", "-an", str(config.partial(dest)),
                ],
                f"segment {shot.shot_id}",
            )
            os.replace(config.partial(dest), dest)
            made += 1
            tag = f"rendered {probe_duration(dest):.2f}s"
        else:
            cached += 1
            tag = "cached"

        log(f"  {shot.shot_id}  {shot.duration:5.2f}s visible  "
            f"{shot.rendered_duration:5.2f}s rendered  {shot.motion.zoom}/{shot.motion.pan:<5}  {tag}")

    log(f"  segments: {made} rendered, {cached} cached")
    return out


#: The delivered film: what is uploaded, played in the browser and posted.
#: CRF 18 at preset medium cost 37-47 MB a minute, and the free Blob store is
#: 1 GB. Measured on a minute of the Aztec film and 20 dark seconds of the
#: Roman one, against the CRF 18 film: CRF 24 with preset slow and tune film is
#: 17.2 MB/min at VMAF 95.6 (bright) and 16.3 MB/min at VMAF 93.9 (dark, where
#: CRF 18 was 47), with no banding visible even with the shadows brightened
#: 2.2x. Encode time is the same as before. Tune stillimage was larger at equal
#: quality; 24 fps saved only 6%; aq-mode 3 gained nothing. The Ken Burns
#: segments that feed this stay at CRF 17: they are local intermediates.
FILM_VIDEO = ["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-tune", "film"]
#: Narration is one voice synthesized at 24 kHz mono; 192 kbps stereo carried
#: nothing more than 96 kbps mono.
FILM_AUDIO = ["-c:a", "aac", "-b:a", "96k", "-ac", "1"]


#: Chunk and narration timestamps start here, not at zero (module docstring,
#: "Timestamps"). Any constant larger than the encoder's reorder delay works.
TS_BASE = 10.0

#: Chunks encode in parallel. x264 threads well on its own, so this buys
#: less than it looks: the whole Roman film took 112 s one at a time and
#: 89 s four at a time. An edit's two chunks finish together.
CHUNK_JOBS = 4

#: For the HLS master playlist: H.264 High at level 4.0 (what libx264 picks
#: for 1080p30) and AAC-LC.
HLS_CODECS = "avc1.640028,mp4a.40.2"


@dataclass(frozen=True)
class Chunk:
    """Shot `index`'s stretch of the film: frames [start, start + frames)."""

    index: int
    start: int
    frames: int
    #: Frames of the shot's own segment that the previous chunk already drew
    #: (the dissolve into it). 0 for the first shot.
    lead: int
    segment: str
    #: The next shot's segment, dissolved into over the last X frames.
    next_segment: str | None
    hash: str

    @property
    def name(self) -> str:
        return f"{self.hash}.ts"


def plan_chunks(timeline: Timeline) -> list[Chunk]:
    """Where every chunk starts and what it is made of. Pure arithmetic."""
    fps = timeline.render["fps"]
    x = round(timeline.render["xfade"] * fps)
    shots = timeline.shots
    starts = [round(s.start * fps) for s in shots] + [round(timeline.duration * fps)]
    segs = [segment_hash(s, timeline.render) for s in shots]
    out: list[Chunk] = []
    for i, s in enumerate(shots):
        frames = starts[i + 1] - starts[i]
        if frames < x + 1:
            raise RuntimeError(f"{s.shot_id} is {frames} frames, not longer than the "
                               f"{x}-frame dissolve")
        lead = 0 if i == 0 else x
        nxt = segs[i + 1] if i + 1 < len(shots) else None
        h = sha("chunk-v1", segs[i], nxt, lead, x, starts[i], frames, fps,
                timeline.render["width"], timeline.render["height"], FILM_VIDEO, TS_BASE)
        out.append(Chunk(index=i, start=starts[i], frames=frames, lead=lead,
                         segment=segs[i], next_segment=nxt, hash=h))
    return out


def _encode_chunk(chunk: Chunk, timeline: Timeline, segments: list[Path], dest: Path) -> None:
    fps = timeline.render["fps"]
    x = round(timeline.render["xfade"] * fps)
    norm = f"settb=AVTB,fps={fps},format=yuv420p,setsar=1"
    # tpad: a segment rendered one frame short of the chunk's need (rounding
    # its length separately from the film's) is padded rather than allowed to
    # end the dissolve early. trim then cuts the chunk to its exact length.
    filters = [f"[0:v]{norm},trim=start_frame={chunk.lead},setpts=PTS-STARTPTS,"
               f"tpad=stop_mode=clone:stop=4[a]"]
    inputs = ["-i", str(segments[chunk.index])]
    last = "a"
    if chunk.next_segment is not None:
        inputs += ["-i", str(segments[chunk.index + 1])]
        filters.append(f"[1:v]{norm},tpad=stop_mode=clone:stop=4[b]")
        filters.append(f"[a][b]xfade=transition=fade:duration={x / fps:.6f}:"
                       f"offset={(chunk.frames - x) / fps:.6f}[x]")
        last = "x"
    filters.append(f"[{last}]trim=end_frame={chunk.frames},setpts=PTS-STARTPTS[v]")
    tmp = config.partial(dest)
    _run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[v]",
         *FILM_VIDEO, "-pix_fmt", "yuv420p", "-frames:v", str(chunk.frames),
         "-muxdelay", "0", "-muxpreload", "0", "-avoid_negative_ts", "disabled",
         "-output_ts_offset", f"{TS_BASE + chunk.start / fps:.6f}", "-f", "mpegts", str(tmp)],
        f"chunk {timeline.shots[chunk.index].shot_id}",
    )
    got = count_frames(tmp)
    if got != chunk.frames:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"chunk {timeline.shots[chunk.index].shot_id} came out {got} frames, "
                           f"not {chunk.frames}: the film would drift from its narration")
    os.replace(tmp, dest)


def count_frames(path: Path) -> int:
    out = _run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
                "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)],
               f"ffprobe {path.name}")
    # MPEG-TS lists the stream once per program as well; the counts agree.
    return int(next(t for t in out.replace(",", " ").split() if t.isdigit()))


def render_chunks(timeline: Timeline, paths, *, jobs: int = CHUNK_JOBS, encoded: list | None = None,
                  log=print) -> list[tuple[Chunk, Path]]:
    """Every chunk of the film, encoding only the ones nobody has made.

    A chunk counts as made if it is on this disk or the media store has it,
    so an edit on a machine that did not render the film encodes the chunks
    its change touched and nothing else, without downloading the rest."""
    plan = plan_chunks(timeline)
    chunk_dir = paths.cache / "chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    out = [(c, chunk_dir / c.name) for c in plan]
    todo = [(c, p) for c, p in out if not paths.mirror.has(p)]
    need = {i for c, _ in todo for i in (c.index, c.index + 1) if i < len(plan)}
    segments = render_segments(timeline, paths, only=need,
                               log=log if len(need) == len(plan) else (lambda *a: None))
    if todo:
        with ThreadPoolExecutor(max(1, jobs)) as ex:
            list(ex.map(lambda cp: _encode_chunk(cp[0], timeline, segments, cp[1]), todo))
    log(f"  chunks: {len(todo)} encoded, {len(plan) - len(todo)} unchanged")
    if encoded is not None:
        encoded.extend(c.index for c, _ in todo)
    return out


#: Narration slices for the player, in seconds. One file in the store, read
#: by byte range, so the player starts after the first slice instead of after
#: the whole narration (7.9 MB for six minutes took 7.6 s before the film
#: could start; PLAN.md 12.6).
NARRATION_SLICE_SECONDS = 6


def narration_stream(timeline: Timeline, wav: Path, paths) -> tuple[Path, Path]:
    """The narration as the film's one audio stream, encoded once per wav,
    and its byte-range index ([[seconds, length, offset], ...]) beside it.
    Edits never change it, so a film's edits all share these two files."""
    dest = paths.cache / "narration" / (
        sha("narr-ts-v2", file_sha(wav), round(timeline.duration, 4), FILM_AUDIO, TS_BASE,
            NARRATION_SLICE_SECONDS) + ".ts")
    index = dest.with_suffix(".json")
    if paths.mirror.has(dest) and paths.mirror.has(index):
        return dest, index
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = config.partial(dest)
    playlist = tmp.with_suffix(".m3u8")
    _run(
        ["ffmpeg", "-y", "-i", str(wav),
         "-af", f"apad,atrim=0:{timeline.duration:.4f},asetpts=N/SR/TB,aresample=48000",
         *FILM_AUDIO, "-muxdelay", "0", "-muxpreload", "0", "-avoid_negative_ts", "disabled",
         "-output_ts_offset", f"{TS_BASE:.6f}",
         "-f", "hls", "-hls_time", str(NARRATION_SLICE_SECONDS), "-hls_playlist_type", "vod",
         "-hls_flags", "single_file", "-hls_segment_type", "mpegts",
         "-hls_segment_filename", str(tmp), str(playlist)],
        "narration stream",
    )
    slices, seconds = [], None
    for line in playlist.read_text().splitlines():
        if line.startswith("#EXTINF:"):
            seconds = float(line[8:].split(",")[0])
        elif line.startswith("#EXT-X-BYTERANGE:"):
            length, offset = line[17:].split("@")
            slices.append([seconds, int(length), int(offset)])
    playlist.unlink(missing_ok=True)
    if not slices or slices[-1][1] + slices[-1][2] != tmp.stat().st_size:
        raise RuntimeError("narration stream: the slices do not cover the file")
    index_tmp = config.partial(index)
    index_tmp.write_text(json.dumps(slices))
    os.replace(tmp, dest)
    os.replace(index_tmp, index)
    return dest, index


def film(timeline: Timeline, chunks: list[Path], wav: Path, dest: Path, *, log=print) -> Path:
    """The chunks as one mp4 by stream copy, the narration encoded beside
    them, and the length checked against the timeline.

    The narration is encoded here rather than copied from the HLS stream: an
    mp4 can say how much of the AAC encoder's priming to skip, and a stream
    copied out of MPEG-TS has lost that, which would put the voice 21 ms late."""
    listing = config.partial(dest).with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in chunks))
    duration = timeline.duration
    try:
        _run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-i", str(wav),
             "-map", "0:v", "-map", "1:a", "-c:v", "copy",
             "-af", f"apad,atrim=0:{duration:.4f},asetpts=N/SR/TB,aresample=48000",
             *FILM_AUDIO, "-movflags", "+faststart", str(config.partial(dest))],
            "film",
        )
    finally:
        listing.unlink(missing_ok=True)
    os.replace(config.partial(dest), dest)

    actual = probe_duration(dest)
    drift = actual - duration
    log(f"  {dest.name}  {actual:.2f}s (timeline {duration:.2f}s, drift {drift * 1000:+.0f}ms)")

    # One frame of slack, as before chunks existed. Anything larger means the
    # chunk arithmetic is wrong and the film runs ahead of or behind its words.
    fps = timeline.render["fps"]
    tolerance = 1.5 / fps
    if abs(drift) > tolerance:
        raise RuntimeError(
            f"rendered video is {actual:.3f}s but the timeline says {duration:.3f}s "
            f"({drift * 1000:+.0f}ms, tolerance {tolerance * 1000:.0f}ms). "
            "The chunk arithmetic is wrong: audio and image are out of sync."
        )
    return dest


@dataclass
class Rendered:
    chunks: list[tuple[Chunk, Path]]
    narration: Path
    narration_index: Path
    video: Path | None
    #: Shot indexes whose chunks this render encoded (the rest existed).
    encoded: list[int]


def build(timeline: Timeline, paths, *, audio: Path | None = None, mp4: bool = True,
          log=print) -> Rendered:
    """Chunks and the narration stream, and the mp4 unless `mp4=False`.

    A production render builds the mp4 (it is local, and its length is the
    sync check); an edit does not, and each new chunk's frame count is
    checked as it is encoded instead."""
    ok, msg = preflight()
    if not ok:
        raise RuntimeError(msg)
    audio = audio or paths.audio
    encoded: list[int] = []
    chunks = render_chunks(timeline, paths, encoded=encoded, log=log)
    narration, narration_index = narration_stream(timeline, audio, paths)
    video = None
    if mp4:
        for _, p in chunks:
            paths.mirror.ensure(p)
        video = film(timeline, [p for _, p in chunks], audio, paths.video, log=log)
    return Rendered(chunks=chunks, narration=narration, narration_index=narration_index, video=video,
                    encoded=encoded)
