"""Sound effects: the stock library, and a film's sounds mixed into its soundtrack.

A sound on a film is a cue on its timeline (`Timeline.sounds`): which sound,
when, how loud. Like everything else on the timeline it is data, and the film
is a render of it. Cues sit at absolute times on the narration, and the
narration never moves (pipeline/edits.py), so a cue placed on a word stays on
that word through every later edit.

### Where the stock sounds come from

The library is the studio's, not the internet's. Each sound is one of:

- **made** here (pipeline/sfx_synth.py): the fail horn, the air horn, the
  rimshot, the boom, cartoon effects. Instruments and effects synthesize well,
  and a sound made from oscillators carries no licence and matches nobody's
  recording in Content ID;
- **recorded**, from Wikimedia Commons, for what does not synthesize
  (laughter, applause, a crowd, animals). Public domain or CC0, except the
  audience laughter, which is CC BY 3.0 and is credited in the YouTube
  description of any film that uses it (`Recording.credit`, publish.draft).

Famous meme clips (a particular "bruh", a particular boom) are someone's
recording. The studio does not ship them; a person can upload their own
(the `sounds` table, migration 009) and owns that choice.

`python -m pipeline.sfx build` fetches each recording (checked against the
SHA-1 Commons publishes), trims it to the moment that matters, starts it on
its first sound so a cue lands where it is placed, levels every sound to the
same loudness, and writes `pipeline/sounds/<id>.mp3`, with the same file in
web/public/sfx for the studio's previews. The files are committed: the worker
never fetches anything to mix a film.

### The mix

The soundtrack is the narration with every cue added at its sample, through
a limiter so a loud sound over a loud word cannot clip. It is content-
addressed like everything else, and a film with no sounds has no mix at all:
its narration stream, its hash and its bytes are what they always were
(assemble.narration_stream). A cue changes only the audio, so an edit that
adds a sound re-encodes no picture.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import config
from .timeline import file_sha, sha

#: The stock sounds, as the worker mixes them and the studio previews them.
SOUNDS_DIR = Path(__file__).resolve().parent / "sounds"
WEB_DIR = config.REPO / "web" / "public" / "sfx"

#: Mixed at the rate the film's audio is delivered at (assemble FILM_AUDIO
#: resamples to 48 kHz): the narration is 24 kHz, a cymbal is not.
MIX_RATE = 48_000

#: Cue volumes the studio offers, as gains on the levelled sound.
VOLUMES = {"quiet": 0.45, "normal": 1.0, "loud": 1.7}

#: Every stock sound is levelled so its loudest `LEVEL_WINDOW` sits at
#: `LEVEL_RMS` (dBFS), and no sample above `LEVEL_PEAK`. Against the
#: narration, measured on four films: its loudest 200 ms sit at -11 to -14,
#: a typical word (90th percentile) at -18 to -20. So a sound at "normal"
#: lands like the voice's loudest words, which is what a meme hit wants;
#: "quiet" puts a laugh under the next line.
LEVEL_RMS = -14.0
LEVEL_WINDOW = 0.2
LEVEL_PEAK = -1.0

#: Most cues one film may carry, and the longest an uploaded sound may be.
MAX_CUES = 120
MAX_UPLOAD_SECONDS = 20.0


@dataclass(frozen=True)
class Recording:
    """A file on Wikimedia Commons, and the part of it the sound is."""

    title: str
    url: str
    sha1: str
    license: str
    author: str
    trim: tuple[float, float] | None = None

    @property
    def page(self) -> str:
        return "https://commons.wikimedia.org/wiki/" + self.title.replace(" ", "_")

    @property
    def credit(self) -> str | None:
        """What the licence asks a film to say, or None for CC0 and public domain."""
        if self.license in ("CC0", "Public domain"):
            return None
        return f"{self.author}, {self.license}, {self.page}"


@dataclass(frozen=True)
class Sound:
    id: str
    name: str
    group: str
    #: A recipe in sfx_synth.RECIPES, or a recording.
    source: str | Recording

    @property
    def credit(self) -> str | None:
        return self.source.credit if isinstance(self.source, Recording) else None


def _commons(title: str, path: str, sha1: str, license: str, author: str,
             trim: tuple[float, float] | None = None) -> Recording:
    return Recording(title, f"https://upload.wikimedia.org/wikipedia/commons/{path}", sha1, license, author, trim)


_LONEMONK = "lonemonk (freesound.org)"

#: Groups in the order the studio lists them. Ids and names match
#: web/lib/sounds.ts (selftest checks).
GROUPS = ["Laughs", "Crowd", "Fails and wins", "Meme hits", "Cartoon", "Voices", "Things", "Spooky and wild"]

STOCK: dict[str, Sound] = {s.id: s for s in [
    # ---- Laughs
    Sound("laugh_track", "Audience laugh", "Laughs", _commons(
        "File:72843 lonemonk approx-800-laughter-only-1.wav",
        "5/55/72843_lonemonk_approx-800-laughter-only-1.wav",
        "ef2c8d9a42236520c471c6573b8b49b646716549", "CC BY 3.0", _LONEMONK, (0.0, 6.5))),
    Sound("big_laugh", "Big laugh", "Laughs", _commons(
        "File:72842 lonemonk approx-800-laugh-1.wav", "1/15/72842_lonemonk_approx-800-laugh-1.wav",
        "da2e56fef6eb5ce96a91b13fb3a6ab0160d0eaa7", "CC BY 3.0", _LONEMONK)),
    Sound("laugh_applause", "Laugh and applause", "Laughs", _commons(
        "File:72844 lonemonk approx-800-laughter-and-clapter-1.wav",
        "e/e5/72844_lonemonk_approx-800-laughter-and-clapter-1.wav",
        "b91dff872db3dc2c24caa7d23fa370c6ae2ec6bf", "CC BY 3.0", _LONEMONK)),
    Sound("chuckle", "Chuckle", "Laughs", _commons(
        "File:Laughter(s).ogg", "c/cb/Laughter%28s%29.ogg",
        "5a426b97014a92bcd5d2ab4ee325eb431e70382d", "CC0", "sagetyrtle", (0.4, 2.6))),
    Sound("evil_laugh", "Evil laugh", "Laughs", _commons(
        "File:Evil laughter.ogg", "f/fb/Evil_laughter.ogg",
        "d85a467baa948e957262c7d77f3f7225554ea880", "Public domain", "stilgar", (0.2, 3.9))),
    Sound("maniac_laugh", "Maniac laugh", "Laughs", _commons(
        "File:Anonyme - Rire horrible 1.ogg", "a/ac/Anonyme_-_Rire_horrible_1.ogg",
        "fc28f394bac2f7e5afcaf6f802a795dfd82ee07c", "CC0", "unknown")),
    Sound("villain_chorus", "Villains cackling", "Laughs", _commons(
        "File:Evil laugh.ogg", "4/48/Evil_laugh.ogg",
        "855d5856cfeeabbdcbdf1d977930958b76d4578e", "CC0", "freesound", (3.0, 9.0))),
    # ---- Crowd
    Sound("applause", "Applause", "Crowd", _commons(
        "File:Sound Effects - Applause after a concert.ogg", "3/32/Sound_Effects_-_Applause_after_a_concert.ogg",
        "4e9a9f7235b36cc46702f40934d8949449cbeca4", "CC0", "Amada44", (0.0, 6.0))),
    Sound("clapping_cheer", "Clapping and cheering", "Crowd", _commons(
        "File:Clapping hurray.ogg", "a/a8/Clapping_hurray.ogg",
        "f215f4bb86e104d19c1d04f26cb2b09cf876bb64", "Public domain", "starlite", (0.0, 7.0))),
    Sound("hurray", "Hurray", "Crowd", _commons(
        "File:Hurray.ogg", "e/e8/Hurray.ogg",
        "1c9b67f9090c4b102864026672d9c7b57d8baf53", "Public domain", "starlite")),
    Sound("slow_clap", "Slow clap", "Crowd", "slow_clap"),
    Sound("crowd_ooh", "Crowd ooh", "Crowd", _commons(
        "File:Ohhh ahhh.ogg", "0/0f/Ohhh_ahhh.ogg",
        "a8a99d1f4fedc9493b6e3470f872f8b76aa08fdc", "Public domain", "starlite")),
    Sound("boo", "Booing", "Crowd", _commons(
        "File:Soundgoats - Audience Booing.wav", "e/e5/Soundgoats_-_Audience_Booing.wav",
        "6e680155902b4356b83cca91229c4efb408c25eb", "Public domain", "Brendon", (0.0, 5.0))),
    Sound("crickets", "Crickets", "Crowd", "crickets"),
    # ---- Fails and wins
    Sound("sad_trombone", "Fail horn", "Fails and wins", "sad_trombone"),
    Sound("wrong_buzzer", "Wrong buzzer", "Fails and wins", "wrong_buzzer"),
    Sound("error", "Error", "Fails and wins", "error"),
    Sound("correct_ding", "Correct ding", "Fails and wins", "correct_ding"),
    Sound("tada", "Ta-da", "Fails and wins", "tada"),
    Sound("level_up", "Level up", "Fails and wins", "level_up"),
    Sound("coin", "Coin", "Fails and wins", "coin"),
    Sound("cash_register", "Cash register", "Fails and wins", _commons(
        "File:Cash register.ogg", "7/70/Cash_register.ogg",
        "c789a1a76e78af18370df374f4274a55e6fc9d5c", "Public domain", "unknown")),
    Sound("bugle_call", "Bugle call", "Fails and wins", _commons(
        "File:FirstCall.mp3", "5/5d/FirstCall.mp3",
        "87104c7cbe43fd6d6e335c73a7a241973727cb12", "Public domain", "U.S. Army")),
    Sound("drum_roll", "Drum roll", "Fails and wins", _commons(
        "File:Drum Roll Intro.ogg", "c/c4/Drum_Roll_Intro.ogg",
        "e5109afea058cbc4a631fb6d05c72353bfa54ac3", "CC0", "Iwan Sounds and DIY")),
    # ---- Meme hits
    Sound("air_horn", "Air horn", "Meme hits", "air_horn"),
    Sound("bass_boom", "Boom", "Meme hits", "bass_boom"),
    Sound("record_scratch", "Record scratch", "Meme hits", "record_scratch"),
    Sound("rimshot", "Ba-dum-tss", "Meme hits", "rimshot"),
    Sound("dun_dun_dun", "Dun dun duuun", "Meme hits", "dun_dun_dun"),
    Sound("censor_bleep", "Censor bleep", "Meme hits", "censor_bleep"),
    Sound("glitch", "Glitch", "Meme hits", "glitch"),
    Sound("riser", "Suspense riser", "Meme hits", "riser"),
    Sound("dial_up", "Dial-up modem", "Meme hits", _commons(
        "File:Dial up connection.ogg", "4/4f/Dial_up_connection.ogg",
        "4709519e21a9f285755afa5462bc0da131d344d2", "Public domain", "ezwa", (13.0, 21.0))),
    # ---- Cartoon
    Sound("boing", "Boing", "Cartoon", "boing"),
    Sound("bonk", "Bonk", "Cartoon", "bonk"),
    Sound("pop", "Pop", "Cartoon", "pop"),
    Sound("slide_up", "Slide whistle up", "Cartoon", "slide_up"),
    Sound("slide_down", "Slide whistle down", "Cartoon", "slide_down"),
    Sound("whoosh", "Whoosh", "Cartoon", "whoosh"),
    Sound("sparkle", "Sparkle", "Cartoon", "sparkle"),
    Sound("punch", "Punch", "Cartoon", _commons(
        "File:Cartoon Punch Slowed.ogg", "b/b8/Cartoon_Punch_Slowed.ogg",
        "54833d0328e1bad9157286c94a35c41424a04e85", "CC0", "unknown")),
    Sound("thud", "Thud", "Cartoon", _commons(
        "File:Dull thud.ogg", "5/5b/Dull_thud.ogg",
        "9e53b37ab4b2e3631d8b980945214db10fed6e8a", "Public domain", "gregoryweir")),
    # ---- Voices
    Sound("scream", "Scream", "Voices", _commons(
        "File:Cri Wilhelm (Joseph SARDIN).wav", "5/5c/Cri_Wilhelm_%28Joseph_SARDIN%29.wav",
        "5dee579c96344de970ad3d8a266c8830b2a22823", "CC0", "Joseph Sardin")),
    Sound("ahhh", "Ahhh!", "Voices", _commons(
        "File:UncleSigmund - ahhh (cc0) (freesound).mp3", "3/32/UncleSigmund_-_ahhh_%28cc0%29_%28freesound%29.mp3",
        "fec0d313ef149a7b3936bee450606782c6bc9ff6", "CC0", "UncleSigmund")),
    Sound("wolf_whistle", "Wolf whistle", "Voices", _commons(
        "File:Wolf whistle.ogg", "a/ab/Wolf_whistle.ogg",
        "2800e4dd4d59d738fdbf4788c0a0c9c502211bbb", "Public domain", "unknown")),
    Sound("yawn", "Yawn", "Voices", _commons(
        "File:Yawning 1.ogg", "4/43/Yawning_1.ogg",
        "7b6e9dfdc6ce51c8f2e4109eccd824c4536f24ac", "Public domain", "ezwa")),
    Sound("snore", "Snore", "Voices", _commons(
        "File:Snoring of old man.ogg", "b/bf/Snoring_of_old_man.ogg",
        "223c28e79a824212d8062f4d98030558b5fdfd82", "CC0", "Saaabaaato", (0.0, 8.0))),
    # ---- Things
    Sound("explosion", "Explosion", "Things", _commons(
        "File:Explosion 10.ogg", "3/37/Explosion_10.ogg",
        "e24332ca6f3caf39bb5acb30ea91a722b9001163", "Public domain", "tcpp")),
    Sound("gong", "Gong", "Things", _commons(
        "File:Gong or bell vibrant (short).ogg", "4/42/Gong_or_bell_vibrant_%28short%29.ogg",
        "1f59feca1770dafa77cccecf0bf38ed17df85d53", "CC0", "pdsounds.org")),
    Sound("heartbeat", "Heartbeat", "Things", "heartbeat"),
    Sound("camera", "Camera shutter", "Things", _commons(
        "File:Holga shuttersound.ogg", "e/ec/Holga_shuttersound.ogg",
        "4cd90c2fff053bb9b4d264b8d0ee091ec052145c", "Public domain", "Doitashimashite")),
    Sound("bike_bell", "Bike bell", "Things", _commons(
        "File:Bicycle-bell-1.wav", "6/68/Bicycle-bell-1.wav",
        "59504d2bd697908fa6d6c21591b507dcf3ecb3dc", "CC0", "Soundscape_Leuphana")),
    Sound("car_horn", "Car horn", "Things", _commons(
        "File:Car Horn.wav", "8/8c/Car_Horn.wav",
        "66a21379dd6a7948164073066756f3f03c86c1d4", "CC0", "15HPanska_Ruttner_Jan", (0.0, 1.4))),
    Sound("doorbell", "Doorbell", "Things", _commons(
        "File:Doorbell-classic-dingdong.ogg", "f/f5/Doorbell-classic-dingdong.ogg",
        "19a3463c37d4de915d58d54050b8d65d7445e63f", "Public domain", "unknown", (0.0, 3.5))),
    Sound("door_creak", "Door creak", "Things", _commons(
        "File:Door handle creaking.ogg", "7/74/Door_handle_creaking.ogg",
        "676772b90212f35486b0b53f0326f4023ef34489", "Public domain", "stephan", (0.0, 3.0))),
    Sound("typewriter_ding", "Typewriter ding", "Things", _commons(
        "File:406243 stubb typewriter-ding-near-mono.wav", "9/9f/406243_stubb_typewriter-ding-near-mono.wav",
        "1de2af649f4148588384364d54d5143dfb4b457a", "CC0", "_stubb")),
    Sound("referee_whistle", "Referee whistle", "Things", _commons(
        "File:218318 splicesound referee-whistle-blow-gymnasium.wav",
        "7/7d/218318_splicesound_referee-whistle-blow-gymnasium.wav",
        "e6f1406823b79f487e4945b33eb9339f5c7ccb61", "CC0", "SpliceSound")),
    Sound("siren", "Siren", "Things", _commons(
        "File:Doppler effect fast vehicle siren exaggerated.ogg",
        "1/13/Doppler_effect_fast_vehicle_siren_exaggerated.ogg",
        "c0d3a62d00e54cd4aa7ea3ea00de92c0002fe4c8", "Public domain", "CeeKay")),
    Sound("clock_tick", "Clock ticking", "Things", _commons(
        "File:Alarm clock ticking.ogg", "8/8b/Alarm_clock_ticking.ogg",
        "0b8f8f2e821d1b052d725f08bd5b0be539c09d44", "Public domain", "ezwa", (0.0, 5.0))),
    # ---- Spooky and wild
    Sound("thunder", "Thunder", "Spooky and wild", _commons(
        "File:Rain and thunder.ogg", "4/42/Rain_and_thunder.ogg",
        "5cee3290a09118a6d2fcdcbaa17f451f9ec09499", "Public domain", "Caesar", (2.5, 10.0))),
    Sound("ghost", "Ghost", "Spooky and wild", _commons(
        "File:Joseph SARDIN - Fantôme 1.oga", "f/f4/Joseph_SARDIN_-_Fant%C3%B4me_1.oga",
        "0f8cd11fb3652fded4a070c4313196d946d6a284", "CC0", "Joseph Sardin", (0.0, 5.5))),
    Sound("ufo", "UFO fly-by", "Spooky and wild", _commons(
        "File:Joseph SARDIN - Passage soucoupe volante 1.wav",
        "b/b5/Joseph_SARDIN_-_Passage_soucoupe_volante_1.wav",
        "cdf0fe8dc57a2ec16914313e7d0379d94c9ec5e2", "CC0", "Joseph Sardin", (3.0, 13.0))),
    Sound("rooster", "Rooster", "Spooky and wild", _commons(
        "File:Coq qui chante (DenisChardonnet).wav", "4/40/Coq_qui_chante_%28DenisChardonnet%29.wav",
        "8eba2b72664715081d49f76fd1fb18042cd4a1b1", "CC0", "Denis Chardonnet")),
    Sound("cat_meow", "Cat meow", "Spooky and wild", _commons(
        "File:Meow of a pleading cat.oga", "6/6b/Meow_of_a_pleading_cat.oga",
        "337a0fc263567775dcf5e9d65a0e80f9e115712b", "Public domain", "Heismark", (0.2, 2.0))),
    Sound("goat", "Goat", "Spooky and wild", _commons(
        "File:Goat in Antefasy.wav", "1/1f/Goat_in_Antefasy.wav",
        "8c598c614b102bf38fa0297686c81fbc1fd99f27", "CC0", "Gasybeaugosse2020")),
]}

UPLOAD = "upload:"


# --------------------------------------------------------------- the library

def library(uploads: list[dict] = ()) -> dict[str, dict]:
    """Every sound a film may use: sound id -> {"name", "group", "key"?,
    "credit"?}. Stock ids as they are; an upload (a `sounds` row) is
    "upload:<id>" with its media key."""
    out = {s.id: {"name": s.name, "group": s.group, **({"credit": s.credit} if s.credit else {})}
           for s in STOCK.values()}
    for u in uploads:
        out[f"{UPLOAD}{u['id']}"] = {"name": u["name"], "group": "Yours", "key": u["key"]}
    return out


def credits(cues: list[dict]) -> list[str]:
    """What the licences of a film's sounds ask it to say, once each."""
    return list(dict.fromkeys(c["credit"] for c in cues if c.get("credit")))


def sound_file(cue: dict, paths) -> Path:
    """The file a cue plays: a stock sound in the repo, or an uploaded one
    through the media store."""
    if cue["sound"] in STOCK:
        path = SOUNDS_DIR / f"{cue['sound']}.mp3"
        if not path.exists():
            raise RuntimeError(f"the stock sound {cue['sound']} is missing; run python -m pipeline.sfx build")
        return path
    key = cue.get("key")
    path = paths.mirror.path(key) if key else None
    if path is None or not paths.mirror.ensure(path):
        raise RuntimeError(f"the sound “{cue.get('name', cue['sound'])}” is not in the media store")
    return path


# ------------------------------------------------------------------- mixing

def soundtrack(timeline, narration: Path, paths, *, log=print) -> Path:
    """The narration with the timeline's sounds mixed in, at MIX_RATE.
    -> `narration` itself when there are none, so a film without sounds
    keeps every key it had."""
    cues = sorted(timeline.sounds, key=lambda c: c["at"])
    if not cues:
        return narration
    files = [sound_file(c, paths) for c in cues]
    key = sha("mix-v1", file_sha(narration), MIX_RATE, round(timeline.duration, 4),
              [(round(c["at"], 4), round(float(c.get("volume", 1.0)), 3), file_sha(f)) for c, f in zip(cues, files)])
    dest = paths.cache / "mix" / f"{key}.wav"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    mono = f"aresample={MIX_RATE},aformat=sample_fmts=fltp:channel_layouts=mono"
    filters = [f"[0:a]{mono}[n]"]
    inputs = ["-i", str(narration)]
    for i, (c, f) in enumerate(zip(cues, files), start=1):
        inputs += ["-i", str(f)]
        delay = int(round(c["at"] * MIX_RATE))
        filters.append(f"[{i}:a]{mono},volume={float(c.get('volume', 1.0)):.3f},"
                       f"adelay=delays={delay}S:all=1[s{i}]")
    mix = "".join(f"[s{i}]" for i in range(1, len(cues) + 1))
    # duration=first: the narration decides the length. normalize=0: a sum,
    # not an average, or every sound would turn the voice down. The limiter
    # catches a loud sound over a loud word; latency=1 keeps it from
    # delaying the narration by its lookahead, which would put the voice
    # 5 ms behind the picture, and level=0 keeps it from levelling the film.
    filters.append(f"[n]{mix}amix=inputs={len(cues) + 1}:duration=first:normalize=0:dropout_transition=0,"
                   "alimiter=limit=0.97:level=0:latency=1[out]")
    tmp = config.partial(dest)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters), "-map", "[out]",
         "-c:a", "pcm_s16le", "-ar", str(MIX_RATE), "-ac", "1", "-f", "wav", str(tmp)],
        capture_output=True, text=True)
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        tail = " ".join((proc.stderr or "").strip().splitlines()[-3:])
        raise RuntimeError(f"mixing {len(cues)} sound(s) into the narration failed: {tail}")
    os.replace(tmp, dest)
    log(f"  mixed {len(cues)} sound(s) into the narration")
    return dest


# -------------------------------------------------------------------- build

def _decode(path: Path, trim: tuple[float, float] | None = None):
    import numpy as np

    cmd = ["ffmpeg", "-v", "error"]
    if trim:
        cmd += ["-ss", f"{trim[0]:.3f}", "-to", f"{trim[1]:.3f}"]
    cmd += ["-i", str(path), "-ac", "1", "-ar", str(MIX_RATE), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def _fetch(rec: Recording, dest: Path) -> Path:
    import hashlib

    if not (dest.exists() and hashlib.sha1(dest.read_bytes()).hexdigest() == rec.sha1):
        dest.parent.mkdir(parents=True, exist_ok=True)
        # curl, not urllib: some Python installs here have no CA bundle.
        subprocess.run(["curl", "-sSfL", "-A", "youtube-majed-sfx/1.0", "-o", str(config.partial(dest)), rec.url],
                       check=True)
        got = hashlib.sha1(config.partial(dest).read_bytes()).hexdigest()
        if got != rec.sha1:
            raise RuntimeError(f"{rec.title}: SHA-1 {got}, Commons publishes {rec.sha1}")
        os.replace(config.partial(dest), dest)
    return dest


def _shape(x, *, cut: bool):
    """Start on the first sound, fade the ends, level to LEVEL_RMS."""
    import numpy as np

    floor = np.abs(x).max() * 10 ** (-40 / 20)
    loud = np.flatnonzero(np.abs(x) > floor)
    if len(loud):
        x = x[max(0, loud[0] - int(0.004 * MIX_RATE)):loud[-1] + int(0.05 * MIX_RATE)]
    fade_in, fade_out = int(0.003 * MIX_RATE), int((0.35 if cut else 0.02) * MIX_RATE)
    x = x.copy()
    x[:fade_in] *= np.linspace(0, 1, fade_in)
    x[-fade_out:] *= np.linspace(1, 0, fade_out) ** 2
    w = int(LEVEL_WINDOW * MIX_RATE)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="valid").max()) if len(x) > w \
        else np.sqrt(np.mean(x ** 2))
    gain = 10 ** (LEVEL_RMS / 20) / max(rms, 1e-9)
    gain = min(gain, 10 ** (LEVEL_PEAK / 20) / max(np.abs(x).max(), 1e-9))
    return x * gain


def build(*, cache: Path | None = None, only: set[str] | None = None, log=print) -> list[Path]:
    """Make every stock sound into SOUNDS_DIR and WEB_DIR (module docstring)."""
    import numpy as np

    from . import sfx_synth

    cache = cache or config.REPO / "work" / "sfx-src"
    SOUNDS_DIR.mkdir(exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    made = []
    for s in STOCK.values():
        if only and s.id not in only:
            continue
        if isinstance(s.source, Recording):
            src = _fetch(s.source, cache / s.source.sha1)
            x = _shape(_decode(src, s.source.trim), cut=s.source.trim is not None)
            how = f"{s.source.license}, {s.source.title[5:]}"
        else:
            x = sfx_synth.RECIPES[s.source]()
            if sfx_synth.SR != MIX_RATE:
                raise RuntimeError("sfx_synth.SR must equal MIX_RATE")
            x = _shape(x, cut=False)
            how = "made"
        wav = config.partial(SOUNDS_DIR / f"{s.id}.wav")
        pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
        _write_wav(wav, pcm)
        dest = SOUNDS_DIR / f"{s.id}.mp3"
        # -map_metadata -1 and no encoder tag: the same samples give the same bytes.
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-map_metadata", "-1",
                        "-fflags", "+bitexact", "-flags:a", "+bitexact", "-c:a", "libmp3lame", "-b:a", "128k",
                        "-ar", str(MIX_RATE), "-ac", "1", str(config.partial(dest))], check=True)
        wav.unlink()
        os.replace(config.partial(dest), dest)
        shutil.copyfile(dest, WEB_DIR / dest.name)
        log(f"  {s.id:16s} {len(x) / MIX_RATE:5.2f}s  {how}")
        made.append(dest)
    return made


def _write_wav(path: Path, pcm) -> None:
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(MIX_RATE)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    import sys

    args = sys.argv[1:]
    if not args or args[0] != "build":
        sys.exit("python -m pipeline.sfx build [ID ...]   # make the stock sounds into pipeline/sounds and web/public/sfx")
    build(only=set(args[1:]) or None)
