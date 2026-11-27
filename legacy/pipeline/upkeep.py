"""Keeping the media store whole and inside its 1 GB.

    python -m pipeline.jobs heal-cuts [--project P]
    python -m pipeline.jobs prune-films [--apply]

**heal-cuts** makes every cut playable from the store. A cut from before
Phase 4 has a whole-film mp4 and no chunks; a cut made without the store
(local testing) names chunks the store never received. Each is cut into
chunks from its own timeline (content-addressed, so whatever exists is
reused), anything the store lacks is uploaded, and the cut's `media` is
rewritten to point at them. Only `media` changes: it is delivery data derived
from the cut, and the shots, words and pictures stay exactly as they were.

**prune-films** deletes whole-film mp4s nothing needs: one no cut points at
any more, and exports (an export is rebuilt from a cut's chunks in seconds,
so the download link simply goes back to "Prepare a download"). It lists
what it would delete unless given --apply. Run heal-cuts first: a cut still
playing from its mp4 keeps that mp4.
"""

from __future__ import annotations

from pathlib import Path

from psycopg.types.json import Jsonb

from . import assemble, config, media, production
from .store import MediaIndex, Store
from .timeline import Timeline


def _playable(tl: dict, index: MediaIndex) -> bool:
    hls = (tl.get("media") or {}).get("hls")
    if not hls or not hls.get("narration_slices"):
        return False
    keys = [c["key"] for c in hls["chunks"]] + [hls["narration"]]
    return set(keys) <= index.known_many(keys)


def heal_cuts(store: Store, root: Path, remote: media.Remote, *, project: str | None = None,
              log=print) -> dict:
    index = MediaIndex(store, remote.name)
    rows = store._all(
        "SELECT id, project_id, version, timeline_json FROM timelines "
        + ("WHERE project_id = %s " if project else "") + "ORDER BY project_id, version",
        (project,) if project else None)
    out = {"healed": 0, "fine": 0, "skipped": []}
    for row in rows:
        name = f"{row['project_id']} cut {row['version']}"
        if _playable(row["timeline_json"], index):
            out["fine"] += 1
            continue
        tl = Timeline.from_json(row["timeline_json"])
        mirror = media.Mirror(root / "cache", remote,
                              MediaIndex(store, remote.name, project_id=row["project_id"]), log=log)
        paths = config.Paths(root=root, project=row["project_id"], mirror=mirror)
        key = tl.audio.get("key")
        wav = mirror.path(key) if key else paths.audio
        missing = [s.shot_id for s in tl.shots if s.image is None
                   or not mirror.ensure(paths.root / s.image.path)]
        if not (mirror.ensure(wav) if key else wav.exists()) or missing:
            why = f"no narration at {wav}" if not wav.exists() else f"stills missing for {missing[:5]}"
            out["skipped"].append(f"{name}: {why}")
            log(f"  skip {name}: {why}")
            continue
        rendered = assemble.build(tl, paths, audio=wav, mp4=False, log=lambda *a: None)
        production.publish_render(tl, rendered, paths, log=lambda *a: None)
        store.conn.execute("UPDATE timelines SET timeline_json = jsonb_set(timeline_json, '{media}', %s) "
                           "WHERE id = %s", (Jsonb(tl.media), row["id"]))
        out["healed"] += 1
        log(f"  healed {name}: {len(rendered.encoded)} chunks encoded, now plays from the store")
    return out


def prune_films(store: Store, remote: media.Remote, *, apply: bool = False, log=print) -> dict:
    films = store._all("SELECT key, size FROM media WHERE store = %s AND kind = 'film'", (remote.name,))
    used = {r["film"] for r in store._all(
        "SELECT timeline_json->'media'->>'film' AS film FROM timelines "
        "WHERE timeline_json->'media'->>'film' IS NOT NULL")}
    gone, kept, freed = [], [], 0
    for f in films:
        if f["key"] in used:
            kept.append(f["key"])
            continue
        gone.append(f["key"])
        freed += f["size"]
        if apply:
            remote.delete(f["key"])
            store.conn.execute("DELETE FROM media WHERE store = %s AND key = %s", (remote.name, f["key"]))
            # An export of it now reads as never made: the page offers to make it again.
            store.conn.execute("UPDATE jobs SET checkpoint = checkpoint - 'film' - 'size' "
                               "WHERE kind = 'export' AND checkpoint->>'film' = %s", (f["key"],))
        log(f"  {'deleted' if apply else 'would delete'} {f['key']} ({f['size'] / 1e6:.0f} MB)")
    for k in kept:
        log(f"  kept {k}: a cut still plays from it (run heal-cuts first)")
    return {"deleted" if apply else "would_delete": gone, "kept": kept, "freed_mb": round(freed / 1e6)}
