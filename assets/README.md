# assets/

Local, licensed media. The audio files are gitignored; `sources.json` (every
asset with its licence) and this README are committed.

- `sources.json`: the manifest. Every file the studio may mix, its kind
  (`sfx`, `ambience`, `riser`, `hit`, `whoosh`, `music`), tags, moods and a
  `licence` with author and source. Only **CC0, public domain and own work**
  (docs/PLAN.md section 7).
- `sfx/legacy/`: copied (never moved) from `legacy/pipeline/sounds/`; licences
  from `legacy/pipeline/sfx.py`. The three CC BY 3.0 laughs are not imported.
- `sfx/commons/`: CC0 / public-domain recordings from Wikimedia Commons, each
  checked against the SHA-1 the manifest records.
- `sfx/synth/`, `music/placeholder/`: made by `audio/studio_audio/sfx_synth.py`
  (own work). The music beds are placeholders until real music is chosen.
- `music/`: royalty-free beds with loop points and stings.
- `voices/`: reference clips for the signature voice (own voice, or with written permission).
- `index.sqlite`: the asset index (kind, tags, moods, length, loudness, onset,
  peak, loop points, licence), rebuilt from the manifest.

```bash
pnpm assets seed      # copy legacy, download Commons, render synth (skips files already there)
pnpm assets index     # measure everything into assets/index.sqlite, print licence counts
pnpm assets summary
```

To add a file: put it under `sfx/` or `music/`, add an entry to `sources.json`
with its licence, run `pnpm assets index`.
