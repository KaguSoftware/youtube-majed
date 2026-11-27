/** The studio's stock sound effects. Ids, names and groups are
 *  pipeline/sfx.py STOCK and GROUPS, in the same order; pipeline/selftest.py
 *  checks the lists agree and that every sound's preview in public/sfx is the
 *  very file the studio machine mixes. `seconds` is the sound's length. Pure
 *  data, safe to import from client components. */

export const GROUPS = ["Laughs", "Crowd", "Fails and wins", "Meme hits", "Cartoon", "Voices", "Things", "Spooky and wild"] as const;

export type Group = (typeof GROUPS)[number];

export const STOCK = [
  { id: "laugh_track", name: "Audience laugh", group: "Laughs", seconds: 6.4 },
  { id: "big_laugh", name: "Big laugh", group: "Laughs", seconds: 2.4 },
  { id: "laugh_applause", name: "Laugh and applause", group: "Laughs", seconds: 9.9 },
  { id: "chuckle", name: "Chuckle", group: "Laughs", seconds: 2.2 },
  { id: "evil_laugh", name: "Evil laugh", group: "Laughs", seconds: 3.6 },
  { id: "maniac_laugh", name: "Maniac laugh", group: "Laughs", seconds: 4.3 },
  { id: "villain_chorus", name: "Villains cackling", group: "Laughs", seconds: 6.0 },
  { id: "applause", name: "Applause", group: "Crowd", seconds: 6.0 },
  { id: "clapping_cheer", name: "Clapping and cheering", group: "Crowd", seconds: 6.9 },
  { id: "hurray", name: "Hurray", group: "Crowd", seconds: 3.1 },
  { id: "slow_clap", name: "Slow clap", group: "Crowd", seconds: 6.1 },
  { id: "crowd_ooh", name: "Crowd ooh", group: "Crowd", seconds: 4.5 },
  { id: "boo", name: "Booing", group: "Crowd", seconds: 4.7 },
  { id: "crickets", name: "Crickets", group: "Crowd", seconds: 3.6 },
  { id: "sad_trombone", name: "Fail horn", group: "Fails and wins", seconds: 3.4 },
  { id: "wrong_buzzer", name: "Wrong buzzer", group: "Fails and wins", seconds: 0.8 },
  { id: "error", name: "Error", group: "Fails and wins", seconds: 0.4 },
  { id: "correct_ding", name: "Correct ding", group: "Fails and wins", seconds: 1.5 },
  { id: "tada", name: "Ta-da", group: "Fails and wins", seconds: 2.3 },
  { id: "level_up", name: "Level up", group: "Fails and wins", seconds: 1.3 },
  { id: "coin", name: "Coin", group: "Fails and wins", seconds: 0.6 },
  { id: "cash_register", name: "Cash register", group: "Fails and wins", seconds: 2.1 },
  { id: "bugle_call", name: "Bugle call", group: "Fails and wins", seconds: 6.4 },
  { id: "drum_roll", name: "Drum roll", group: "Fails and wins", seconds: 3.8 },
  { id: "air_horn", name: "Air horn", group: "Meme hits", seconds: 2.0 },
  { id: "bass_boom", name: "Boom", group: "Meme hits", seconds: 2.1 },
  { id: "record_scratch", name: "Record scratch", group: "Meme hits", seconds: 0.6 },
  { id: "rimshot", name: "Ba-dum-tss", group: "Meme hits", seconds: 1.6 },
  { id: "dun_dun_dun", name: "Dun dun duuun", group: "Meme hits", seconds: 4.1 },
  { id: "censor_bleep", name: "Censor bleep", group: "Meme hits", seconds: 1.0 },
  { id: "glitch", name: "Glitch", group: "Meme hits", seconds: 1.1 },
  { id: "riser", name: "Suspense riser", group: "Meme hits", seconds: 2.2 },
  { id: "dial_up", name: "Dial-up modem", group: "Meme hits", seconds: 8.0 },
  { id: "boing", name: "Boing", group: "Cartoon", seconds: 0.9 },
  { id: "bonk", name: "Bonk", group: "Cartoon", seconds: 0.4 },
  { id: "pop", name: "Pop", group: "Cartoon", seconds: 0.1 },
  { id: "slide_up", name: "Slide whistle up", group: "Cartoon", seconds: 0.8 },
  { id: "slide_down", name: "Slide whistle down", group: "Cartoon", seconds: 1.0 },
  { id: "whoosh", name: "Whoosh", group: "Cartoon", seconds: 0.7 },
  { id: "sparkle", name: "Sparkle", group: "Cartoon", seconds: 1.8 },
  { id: "punch", name: "Punch", group: "Cartoon", seconds: 0.9 },
  { id: "thud", name: "Thud", group: "Cartoon", seconds: 0.4 },
  { id: "scream", name: "Scream", group: "Voices", seconds: 1.1 },
  { id: "ahhh", name: "Ahhh!", group: "Voices", seconds: 2.5 },
  { id: "wolf_whistle", name: "Wolf whistle", group: "Voices", seconds: 1.1 },
  { id: "yawn", name: "Yawn", group: "Voices", seconds: 5.9 },
  { id: "snore", name: "Snore", group: "Voices", seconds: 7.8 },
  { id: "explosion", name: "Explosion", group: "Things", seconds: 2.6 },
  { id: "gong", name: "Gong", group: "Things", seconds: 5.3 },
  { id: "heartbeat", name: "Heartbeat", group: "Things", seconds: 2.9 },
  { id: "camera", name: "Camera shutter", group: "Things", seconds: 0.6 },
  { id: "bike_bell", name: "Bike bell", group: "Things", seconds: 1.4 },
  { id: "car_horn", name: "Car horn", group: "Things", seconds: 1.0 },
  { id: "doorbell", name: "Doorbell", group: "Things", seconds: 3.4 },
  { id: "door_creak", name: "Door creak", group: "Things", seconds: 2.8 },
  { id: "typewriter_ding", name: "Typewriter ding", group: "Things", seconds: 0.6 },
  { id: "referee_whistle", name: "Referee whistle", group: "Things", seconds: 1.4 },
  { id: "siren", name: "Siren", group: "Things", seconds: 5.9 },
  { id: "clock_tick", name: "Clock ticking", group: "Things", seconds: 5.0 },
  { id: "thunder", name: "Thunder", group: "Spooky and wild", seconds: 7.5 },
  { id: "ghost", name: "Ghost", group: "Spooky and wild", seconds: 5.2 },
  { id: "ufo", name: "UFO fly-by", group: "Spooky and wild", seconds: 9.6 },
  { id: "rooster", name: "Rooster", group: "Spooky and wild", seconds: 2.3 },
  { id: "cat_meow", name: "Cat meow", group: "Spooky and wild", seconds: 1.4 },
  { id: "goat", name: "Goat", group: "Spooky and wild", seconds: 1.7 },
] as const satisfies readonly { id: string; name: string; group: Group; seconds: number }[];

/** Stock sounds whose licence asks a film to credit them (pipeline/sfx.py
 *  Recording.credit); the YouTube description does (publish.draft). */
export const CREDITED: readonly string[] = ["laugh_track", "big_laugh", "laugh_applause"];

/** pipeline/sfx.py VOLUMES: a cue's gain on its levelled sound. */
export const VOLUMES = [{ id: "quiet", label: "Quiet", gain: 0.45 }, { id: "normal", label: "Normal", gain: 1.0 }, { id: "loud", label: "Loud", gain: 1.7 }] as const;

export type VolumeId = (typeof VOLUMES)[number]["id"];

/** pipeline/sfx.py UPLOAD: how a cue names one of the studio's own sounds. */
export const UPLOAD = "upload:";

/** pipeline/sfx.py MAX_CUES and MAX_UPLOAD_SECONDS. */
export const MAX_CUES = 120;
export const MAX_UPLOAD_SECONDS = 20;

export const isStock = (id: string) => STOCK.some((s) => s.id === id);

export const soundSample = (id: string) => `/sfx/${id}.mp3`;
