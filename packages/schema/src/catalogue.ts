/**
 * The library catalogue: every id a scene file may use, with a one-line
 * description. This is the single list. `remotion/` implements each entry
 * (TypeScript checks that every id here has an implementation and vice versa),
 * and later `engine/CLAUDE.md` hands this list to Claude so it only picks ids
 * that exist.
 *
 * Pure data: no React, safe to import anywhere (worker, app, scripts).
 */

type Entry = { description: string };

export const ACTIONS = {
  idle: { description: "Stands and breathes with a slow weight shift. The default.", kind: "loop", travels: false },
  talk: { description: "Talks with one hand gesturing and small head nods; mouth moves.", kind: "loop", travels: false },
  think: { description: "Hand to chin, head tilted up, thinking. Holds.", kind: "once", travels: false },
  walk: { description: "Normal walk. Travels toward `to` (or forward if no `to`), then stops.", kind: "loop", travels: true },
  run: { description: "Fast run, leaning forward, arms pumping. Travels.", kind: "loop", travels: true },
  sneak: { description: "Crouched tiptoe, hands up, big careful steps. Travels slowly.", kind: "loop", travels: true },
  sleepwalk: { description: "Stiff shuffle with arms straight out and head drooping. Travels very slowly.", kind: "loop", travels: true },
  look_around: { description: "Nervously looks one way, then the other.", kind: "loop", travels: false },
  point: { description: "Winds up and points straight ahead. Holds the point.", kind: "once", travels: false },
  shrug: { description: "Shoulders up, palms up, head tilted: 'no idea'. Holds.", kind: "once", travels: false },
  facepalm: { description: "Drops face into hand. Holds.", kind: "once", travels: false },
  panic: { description: "Arms flailing over the head, frantic; sweat drops.", kind: "loop", travels: false },
  argue: { description: "Leans in, hand on hip, jabbing a finger; mouth moves.", kind: "loop", travels: false },
  celebrate: { description: "Jumps up and down with both arms in a V.", kind: "loop", travels: false },
  jump: { description: "Crouch, leap, tuck, land with a squash, recover. Once.", kind: "once", travels: false },
  fall: { description: "Slips and falls flat on their back. Ends lying down.", kind: "once", travels: false },
  get_up: { description: "From lying on the back to standing. Once.", kind: "once", travels: false },
  sit: { description: "Sits on the ground (or on a bed/surface prop), hugging the knees. Holds.", kind: "once", travels: false },
  sleep: { description: "Lies on the back asleep, chest rising, floating Zs. Lie on a bed by sharing its pos.", kind: "loop", travels: false },

  // Gestures and talking
  nod: { description: "Nods yes, a few times.", kind: "loop", travels: false },
  head_shake: { description: "Shakes the head no.", kind: "loop", travels: false },
  wave: { description: "Waves hello or goodbye, arm up.", kind: "loop", travels: false },
  clap: { description: "Claps, hands meeting in front of the chest.", kind: "loop", travels: false },
  fist_pump: { description: "Arm up, then pulls the fist down: 'yes!'. Holds.", kind: "once", travels: false },
  bow: { description: "Bows from the waist. Holds.", kind: "once", travels: false },
  salute: { description: "Snaps a salute to the brow. Holds.", kind: "once", travels: false },
  beckon: { description: "'Come here': forearm curling toward the body.", kind: "loop", travels: false },
  stop_hand: { description: "Arm straight out, palm forward: 'stop!'. Holds.", kind: "once", travels: false },
  cross_arms: { description: "Folds the arms, weight back. Holds.", kind: "once", travels: false },
  hands_on_hips: { description: "Hands on hips, chest out. Holds.", kind: "once", travels: false },
  scratch_head: { description: "Scratches the head, puzzled.", kind: "loop", travels: false },
  double_take: { description: "Glances away, then snaps back with a jolt. Holds.", kind: "once", travels: false },
  present: { description: "'Ta-da!': sweeps an arm out to show something. Holds.", kind: "once", travels: false },
  whisper: { description: "Leans in, hand beside the mouth, whispering.", kind: "loop", travels: false },
  shout: { description: "Hands cupped round the mouth, leaning in, yelling.", kind: "loop", travels: false },
  listen: { description: "Hand cupped to the ear, leaning in: eavesdropping.", kind: "loop", travels: false },

  // Feelings and reactions
  gasp: { description: "Recoils, hands to the chest. Holds.", kind: "once", travels: false },
  cower: { description: "Crouches, arms over the head, trembling.", kind: "loop", travels: false },
  tremble: { description: "Hunched and shaking with fear or cold.", kind: "loop", travels: false },
  cry: { description: "Face in hands, shoulders heaving. Forces the crying face.", kind: "loop", travels: false },
  laugh: { description: "Doubled over laughing, hand on the belly. Forces the laughing face.", kind: "loop", travels: false },
  sigh: { description: "Big breath, then slumps: shoulders down, head down. Holds.", kind: "once", travels: false },
  rage: { description: "Stomps, shaking both fists overhead; steam puffs.", kind: "loop", travels: false },
  faint: { description: "Wobbles, then keels over backwards. Ends lying down.", kind: "once", travels: false },
  plead: { description: "On both knees, hands together, begging.", kind: "loop", travels: false },
  kneel: { description: "Drops to one knee (proposals, oaths, tying a lace). Holds.", kind: "once", travels: false },
  yawn: { description: "Big stretch and yawn, then back to standing.", kind: "once", travels: false },
  tap_foot: { description: "Arms folded, tapping a foot: impatient.", kind: "loop", travels: false },
  dance: { description: "Goofy disco dance.", kind: "loop", travels: false },

  // Everyday
  phone_call: { description: "Phone to the ear, talking. Pair with a phone in hand_r.", kind: "loop", travels: false },
  text_phone: { description: "Looks down at the phone in front, thumbing. Pair with a phone in hand_r.", kind: "loop", travels: false },
  read: { description: "Holds something up in front and reads (book, newspaper, letter, map).", kind: "loop", travels: false },
  eat: { description: "Takes bites and chews. Pair with food in hand_r.", kind: "loop", travels: false },
  drink: { description: "Sips, head tipping back. Pair with a mug in hand_r.", kind: "loop", travels: false },
  knock: { description: "Knocks on a door in front.", kind: "loop", travels: false },
  peek: { description: "Leans forward to peek round something, then back.", kind: "loop", travels: false },
  climb: { description: "Climbs in place, hand over hand (a ladder, a wall).", kind: "loop", travels: false },
  sit_chair: { description: "Sits upright on a seat. Needs a seat prop (chair, stool, bench, sofa, crate, rock, bed) at the same pos.", kind: "once", travels: false, needs: "seat" },
  sit_edge: { description: "Perched on an edge, legs dangling and swinging. Needs a seat prop at the same pos.", kind: "loop", travels: false, needs: "seat" },
  type: { description: "Sits typing at a keyboard. Needs a seat prop at the same pos (add a desk there too).", kind: "loop", travels: false, needs: "seat" },
  drive: { description: "Sits in a car holding the wheel; car and driver travel together toward `to`. Needs a car at the same pos.", kind: "loop", travels: true, needs: "vehicle" },

  // Effort and conflict
  push: { description: "Leans in, pushing hard against something.", kind: "loop", travels: false },
  pull: { description: "Leans back, heaving on something (a rope, a door).", kind: "loop", travels: false },
  lift: { description: "Squats, strains, and lifts something to the chest. Holds. Pair with a box in hand_r.", kind: "once", travels: false },
  throw: { description: "Winds up and throws. Holds the follow-through.", kind: "once", travels: false },
  punch: { description: "Winds up and punches straight ahead. Holds.", kind: "once", travels: false },
  kick: { description: "Kicks forward, then puts the foot down.", kind: "once", travels: false },
  dodge: { description: "Ducks back with arms up. Holds.", kind: "once", travels: false },
  fists_up: { description: "Boxing stance, bouncing on the toes.", kind: "loop", travels: false },
  stumble: { description: "Trips forward, windmills the arms, recovers.", kind: "once", travels: false },

  // Travel
  trudge: { description: "Sad, slumped, slow walk. Travels.", kind: "loop", travels: true },
  march: { description: "Proud march, high knees, stiff arms. Travels.", kind: "loop", travels: true },
  skip: { description: "Happy skipping. Travels.", kind: "loop", travels: true },
  flee: { description: "Runs in a panic, arms flailing, looking back. Travels fast.", kind: "loop", travels: true },
  carry: { description: "Walks holding something in front with both hands. Pair with a box in hand_r. Travels.", kind: "loop", travels: true },
  crawl: { description: "Crawls on hands and knees. Travels slowly.", kind: "loop", travels: true },
} as const satisfies Record<string, Entry & { kind: "loop" | "once"; travels: boolean; needs?: "seat" | "vehicle" }>;

export const EXPRESSIONS = {
  neutral: { description: "Calm, relaxed face." },
  happy: { description: "Smiling, eyes curved up." },
  shock: { description: "Wide eyes, raised brows, open O mouth." },
  smirk: { description: "One brow up, half-lidded eye, lopsided smile." },
  fear: { description: "Wide eyes with tiny pupils, worried brows, wavy mouth, sweat drop." },
  sad: { description: "Drooping brows and eyes, frown." },
  angry: { description: "Brows slammed down, narrow eyes, gritted frown." },
  suspicious: { description: "Narrowed eyes, flat low brows, mouth pulled to one side." },
  sleepy: { description: "Eyes closed, small open mouth." },
  crying: { description: "Eyes squeezed shut, tears streaming, wailing mouth." },
  deadpan: { description: "Half-lidded, flat brows, flat mouth: unimpressed." },
  laughing: { description: "Eyes squeezed into > <, huge open laughing mouth." },
  disgusted: { description: "One eye squinting, wrinkled brow, tongue out: 'ew'." },
  confused: { description: "One brow up, mismatched eyes, squiggle mouth, a floating '?'." },
  embarrassed: { description: "Blushing cheeks, eyes looking down, wobbly smile, sweat drop." },
  determined: { description: "Brows down, focused eyes, firm set mouth." },
  in_love: { description: "Pulsing heart eyes, rosy cheeks, dreamy smile." },
} as const satisfies Record<string, Entry>;

export const BACKGROUNDS = {
  house_interior: { description: "Cosy keeper's cottage: wooden floor, window, shelf, rug, lamp.", interior: true, sea: false },
  street: { description: "Small harbour-town street: houses, shop awning, lamp post, cobbles.", interior: false, sea: false },
  forest: { description: "Pine forest path with layered trees and ferns.", interior: false, sea: false },
  lighthouse_exterior: { description: "Red-and-white lighthouse on a rocky point above the sea.", interior: false, sea: true },
  lighthouse_stairs: { description: "Inside the lighthouse: stone wall, spiral stairs rising, small round window.", interior: true, sea: false },
  office: { description: "Open-plan office: desks with monitors, window blinds, water cooler, ceiling lights.", interior: true, sea: false },
  kitchen: { description: "Home kitchen: counters, fridge, stove, hanging pans, window over the sink.", interior: true, sea: false },
  bedroom: { description: "Bedroom: poster on the wall, curtained window, wardrobe, bedside lamp; floor left clear for a bed prop.", interior: true, sea: false },
  classroom: { description: "School classroom: green chalkboard, posters, wall clock, teacher's desk.", interior: true, sea: false },
  lab: { description: "Science lab: benches with bubbling flasks, tiled wall, a big machine with blinking lights.", interior: true, sea: false },
  spaceship: { description: "Spaceship bridge: curved metal walls, big viewport onto stars and a planet, glowing consoles.", interior: true, sea: false },
  cafe: { description: "Diner/café: counter, menu board, pendant lamps, big front window onto the street.", interior: true, sea: false },
  hospital: { description: "Hospital room: pale walls, heart monitor, curtain rail, window, wall sockets.", interior: true, sea: false },
  interrogation: { description: "Police interrogation room: bare walls, one-way mirror, hanging lamp, height chart. True crime.", interior: true, sea: false },
  cave: { description: "Cave: rock arches, stalactites, a glowing pool, darkness at the edges. Always dim.", interior: true, sea: false },
  desert: { description: "Open desert: dunes, mesas, cacti, heat haze by day, huge starry sky at night.", interior: false, sea: false },
  beach: { description: "Sandy beach: sea with rolling waves, palm tree, distant island.", interior: false, sea: true },
  city: { description: "Modern city street: tall buildings with lit windows, crosswalk, traffic light, billboard.", interior: false, sea: false },
  park: { description: "Town park: grass, path, round trees, pond, distant skyline.", interior: false, sea: false },
  mountain: { description: "Snowy mountain pass: peaks, snowy pines, rocky path, cold light.", interior: false, sea: false },
  rooftop: { description: "Flat city rooftop: low ledge, water tower, vents, skyline beyond. Great at night.", interior: false, sea: false },
  road: { description: "Country road: asphalt with lane markings, fields, fence, rolling hills. For car scenes.", interior: false, sea: false },
  graveyard: { description: "Old graveyard: tombstones, crooked bare tree, iron fence, low mist. Horror.", interior: false, sea: false },
} as const satisfies Record<string, Entry & { interior: boolean; sea: boolean }>;

/**
 * Placement: where a prop can go.
 * - hand: must be held (`attach`); hand_or_ground: held or given a `pos`.
 * - ground: stands on the floor at `pos`. wall: hangs on an interior wall at `pos`.
 * - horizon: sits on the sea horizon (backgrounds with `sea`). sky: flies in an outdoor sky at `pos`.
 * Ground props marked "seat" are what perched actions (sit_chair, sit_edge, type, drive) sit on:
 * give the character the same `pos`.
 */
export const PROPS = {
  lantern: { description: "Hand lantern; glows at dusk and night. Attach to a hand.", placement: "hand" },
  oil_can: { description: "Metal oil can with a spout. Hand or ground.", placement: "hand_or_ground" },
  flour_sack: { description: "Sack of flour, slightly spilled. Ground.", placement: "ground" },
  footprints: { description: "Trail of adult boot prints on the ground, starting at pos.", placement: "ground" },
  small_footprints: { description: "Trail of small bare footprints on the ground, starting at pos.", placement: "ground" },
  bed: { seat: true, description: "Simple wooden bed with blanket; a character at the same pos lies or sits on it.", placement: "ground" },
  ship: { description: "Cargo ship on the horizon, bobbing. Sea backgrounds only.", placement: "horizon" },
  clock: { description: "Round wall clock with fast-ticking hands. Wall.", placement: "wall" },

  phone: { description: "Smartphone; screen glows. Held up to the ear for phone_call, in front for text_phone.", placement: "hand" },
  money: { description: "Fan of banknotes held in the hand.", placement: "hand" },
  cards: { description: "Fan of playing cards held in the hand.", placement: "hand" },
  book: { description: "Open hardback book. Hold it for read.", placement: "hand" },
  mug: { description: "Steaming coffee mug. Hold it for drink.", placement: "hand" },
  letter: { description: "Open letter / envelope with a red seal.", placement: "hand" },
  key: { description: "Big old brass key.", placement: "hand" },
  map: { description: "Unfolded paper map with a dotted route and an X.", placement: "hand" },
  umbrella: { description: "Open umbrella held over the head. Pairs with rain.", placement: "hand" },
  flashlight: { description: "Torch/flashlight; throws a beam forward at dusk and night.", placement: "hand" },
  briefcase: { description: "Leather briefcase carried at the side.", placement: "hand" },
  newspaper: { description: "Open newspaper with a big headline block.", placement: "hand" },
  balloon: { description: "Red balloon on a string, floating above the hand.", placement: "hand" },
  flowers: { description: "Bouquet of flowers wrapped in paper.", placement: "hand" },
  magnifier: { description: "Detective's magnifying glass.", placement: "hand" },
  torch: { description: "Burning wooden torch; flickers and glows. Caves, castles, mobs.", placement: "hand" },
  sword: { description: "Cartoon knight's sword. Fantasy and history.", placement: "hand" },
  food: { description: "A sandwich with a bite out of it. Hold it for eat.", placement: "hand" },
  suitcase: { description: "Travel suitcase with stickers. Hand or ground.", placement: "hand_or_ground" },
  box: { description: "Cardboard box, taped. Hold it for carry and lift, or set it down.", placement: "hand_or_ground" },
  gift: { description: "Wrapped present with a bow. Hand or ground.", placement: "hand_or_ground" },
  money_bag: { description: "Sack with a $ sign, stuffed with cash. Hand or ground.", placement: "hand_or_ground" },
  candle: { description: "Candle in a holder; glows. Hand or ground.", placement: "hand_or_ground" },

  door: { description: "Free-standing door in its frame; characters knock on it or peek round it.", placement: "ground" },
  car: { seat: true, vehicle: true, description: "Small round family car, side view. A character at the same pos with drive sits in it and they travel together.", placement: "ground" },
  sign: { description: "Wooden signpost with two blank arrow boards.", placement: "ground" },
  fire: { description: "Campfire with logs and flickering flames; glows warm.", placement: "ground" },
  table: { description: "Wooden table. Put it next to a chair for eating or talking.", placement: "ground" },
  desk: { description: "Desk with a computer monitor and keyboard. Pair with a chair and type.", placement: "ground" },
  chair: { seat: true, description: "Wooden chair. Seat.", placement: "ground" },
  stool: { seat: true, description: "Tall bar stool. Seat.", placement: "ground" },
  bench: { seat: true, description: "Park bench. Seat.", placement: "ground" },
  sofa: { seat: true, description: "Comfy sofa. Seat.", placement: "ground" },
  crate: { seat: true, description: "Wooden crate. Seat.", placement: "ground" },
  rock: { seat: true, description: "Big boulder. Seat; sit_edge on it swings the legs.", placement: "ground" },
  plant: { description: "Potted plant.", placement: "ground" },
  trash_can: { description: "Metal trash can with a lid.", placement: "ground" },
  bicycle: { description: "Bicycle, parked.", placement: "ground" },
  tent: { description: "Camping tent, door flap open.", placement: "ground" },
  ladder: { description: "Tall wooden ladder; pair with climb.", placement: "ground" },
  treasure_chest: { description: "Treasure chest, lid open, gold glinting.", placement: "ground" },
  tv: { description: "Old TV on a stand, screen flickering.", placement: "ground" },
  painting: { description: "Framed landscape painting. Wall.", placement: "wall" },
  wanted_poster: { description: "WANTED poster with a mystery face. Wall.", placement: "wall" },
  calendar: { description: "Wall calendar with pages flipping. Time passing. Wall.", placement: "wall" },
  plane: { description: "Small airliner crossing the sky. Outdoor.", placement: "sky" },
  birds: { description: "Flock of birds flapping across the sky. Outdoor.", placement: "sky" },
} as const satisfies Record<string, Entry & { placement: "hand" | "hand_or_ground" | "ground" | "wall" | "horizon" | "sky"; seat?: true; vehicle?: true }>;

export const CAMERAS = {
  static: { description: "Locked-off camera. No movement." },
  slow_push: { description: "Slow push in toward the characters across the whole scene." },
  shake: { description: "Hard shake that settles into a light tremble. Impacts, panic." },
  zoom_face: { description: "Fast zoom onto the first character's face, then holds. Reactions, reveals." },
  dolly_out: { description: "Starts close, slowly pulls back to reveal the whole frame." },
  pan_left: { description: "Slow sideways drift to the left across the scene." },
  pan_right: { description: "Slow sideways drift to the right across the scene." },
  whip_pan: { description: "Whips in from the side with motion blur, then settles. Energy, 'meanwhile'." },
  tilt_up: { description: "Starts low on the ground and tilts up to the characters. Reveals, arrivals." },
  handheld: { description: "Subtle hand-held wobble. Tension, documentary feel." },
  dutch_angle: { description: "Rolls to a tilted frame and creeps in. Unease, something is wrong." },
} as const satisfies Record<string, Entry>;

export const TRANSITIONS = {
  cut: { description: "Straight cut." },
  whoosh_wipe: { description: "Fast diagonal wipe with a motion streak. Change of place." },
  smash_cut: { description: "Hard cut with a white flash and punch-in. Shock, reveals, comedy." },
  dip_to_black: { description: "Previous scene fades to black, this one fades up. Time skip." },
  crossfade: { description: "Soft dissolve from the previous scene. Gentle change, memories." },
  iris: { description: "A circle opens on the characters from black. Old-cartoon reveal, new chapter." },
  glitch: { description: "Digital glitch: sliced, shifted, colour-split frames, then clean. Tech, horror, twists." },
  page_turn: { description: "The previous scene peels away like a page. Storybook, next part of the story." },
} as const satisfies Record<string, Entry>;

export const GRADES = {
  day: { description: "Bright daylight, light vignette.", timeOfDay: "day" },
  dusk: { description: "Warm orange sunset light.", timeOfDay: "dusk" },
  night: { description: "Cool blue night with a strong vignette; lamps glow.", timeOfDay: "night" },
  memory: { description: "Warm faded sepia with soft edges. Flashbacks, the past.", timeOfDay: "day" },
  horror: { description: "Sickly green night, heavy vignette, flickering light.", timeOfDay: "night" },
  noir: { description: "High-contrast black and white. Crime, mystery.", timeOfDay: "dusk" },
  neon: { description: "Saturated magenta-cyan night. Cities, clubs, sci-fi; pairs with the neon cast style.", timeOfDay: "night" },
} as const satisfies Record<string, Entry & { timeOfDay: "day" | "dusk" | "night" }>;

export const CAPTIONS = {
  word_pop: { description: "Big bold words at the bottom, popping in one by one; current word highlighted." },
  karaoke: { description: "One full line at a time; words light up as they are spoken." },
  subtitle: { description: "Quiet subtitles in a dark box. Serious or emotional scenes." },
  punch: { description: "One huge word at a time in the centre. Punchlines and big reveals." },
  none: { description: "No captions for this scene." },
}

/** Scene weather (optional). Outdoor backgrounds only. */
export const WEATHER = {
  rain: { description: "Steady rain with splashes." },
  storm: { description: "Heavy slanted rain with lightning flashes." },
  snow: { description: "Snow drifting down." },
  fog: { description: "Low fog banks drifting across, distance fades." },
} as const satisfies Record<string, Entry>;

/** Scene framing (optional, default wide). The camera move plays on top of it. */
export const FRAMINGS = {
  wide: { description: "The whole scene, characters full-body. The default." },
  medium: { description: "Waist-up on the characters (fits all of them). Conversations, reactions." },
} as const satisfies Record<string, Entry>;

/**
 * Overlays: on-screen text and graphics above the picture (scene `overlays`).
 * Each has its own fields; see OverlayInScene in scene.ts.
 */
export const OVERLAYS = {
  title_card: { description: "Big centred title with an optional subtitle on a paper banner. Chapter starts." },
  time_card: { description: "Full-width card like '3 HOURS LATER' over a dimmed scene, about 2 s." },
  lower_third: { description: "Name tag at the lower left (or right): name and a short role." },
  map_pin: { description: "A map card slides in; a pin drops on a dotted route, with the place name." },
  counter: { description: "Big number counting up to a value, with optional prefix, suffix and label ('$1,000,000')." },
} as const satisfies Record<string, Entry>;

/** Where a character or ground prop stands, left to right. Offscreen = for entrances/exits. */
export const POSITIONS = {
  offscreen_left: { description: "Just outside the left edge.", x: -0.08 },
  far_left: { description: "Near the left edge.", x: 0.12 },
  left: { description: "Left third.", x: 0.25 },
  center_left: { description: "Between left and centre.", x: 0.38 },
  center: { description: "Centre.", x: 0.5 },
  center_right: { description: "Between centre and right.", x: 0.62 },
  right: { description: "Right third.", x: 0.75 },
  far_right: { description: "Near the right edge.", x: 0.88 },
  offscreen_right: { description: "Just outside the right edge.", x: 1.08 },
} as const satisfies Record<string, Entry & { x: number }>;

/** Prop attach points on a character: `<charId>.<point>`. hand_r is the front hand. */
export const ATTACH_POINTS = {
  hand_r: { description: "Front hand (nearest the camera)." },
  hand_l: { description: "Back hand." },
  head: { description: "Top of the head." },
} as const satisfies Record<string, Entry>;

/** Cast looks: what makes one stick figure recognisable from another. */
export const HATS = {
  none: { description: "Bare head." },
  keeper_cap: { description: "Peaked captain's cap with a coloured band." },
  beanie: { description: "Knitted beanie with a pompom, in the character's colour." },
  top_hat: { description: "Tall top hat with a coloured band." },
  baseball_cap: { description: "Baseball cap in the character's colour, peak forward." },
  fedora: { description: "Detective's fedora with a band. Noir, mystery." },
  cowboy_hat: { description: "Wide-brimmed cowboy hat." },
  crown: { description: "Gold crown with jewels. Kings, queens, winners." },
  hard_hat: { description: "Yellow builder's hard hat." },
  chef_hat: { description: "Tall white chef's toque." },
  police_cap: { description: "Police officer's peaked cap with a badge." },
  beret: { description: "Floppy beret in the character's colour." },
} as const satisfies Record<string, Entry>;

export const HAIR = {
  none: { description: "Bald, or nothing showing under the hat." },
  short: { description: "Short, neat hair." },
  messy: { description: "Spiky, messy hair." },
  long: { description: "Long hair falling past the shoulders." },
  bob: { description: "Chin-length bob with a fringe." },
  bun: { description: "Hair up in a bun." },
  ponytail: { description: "Ponytail that swings when they move." },
  curly: { description: "Big round curly hair." },
} as const satisfies Record<string, Entry>;

export const BEARDS = {
  none: { description: "Clean-shaven." },
  full: { description: "Big bushy beard." },
  stubble: { description: "Stubble shadow on the jaw." },
  moustache: { description: "Bushy moustache." },
  goatee: { description: "Small pointed goatee." },
} as const satisfies Record<string, Entry>;

/** Face extras drawn over any expression; a cast member can have up to 3. */
export const FACE_FEATURES = {
  glasses: { description: "Round glasses." },
  sunglasses: { description: "Dark sunglasses: eyes hidden, brows and mouth still act." },
  lashes: { description: "Eyelashes." },
  freckles: { description: "Freckles across the cheeks." },
  blush: { description: "Rosy cheeks." },
  nose: { description: "A small round nose." },
  eyepatch: { description: "Pirate eyepatch." },
} as const satisfies Record<string, Entry>;

/** Body shape within the stick rig. Height is a separate number (cast `height`). */
export const BUILDS = {
  average: { description: "The default body." },
  slim: { description: "Thin lines and long limbs." },
  broad: { description: "Thick heavy lines, strong torso." },
  round: { description: "Round belly, shorter legs." },
} as const satisfies Record<string, Entry>;

/** Clothing in the cast colour. */
export const OUTFITS = {
  none: { description: "Just the stick figure." },
  tie: { description: "Necktie: office workers, bosses, detectives." },
  scarf: { description: "Scarf with tails that flutter behind." },
  dress: { description: "Dress or skirt that follows the legs." },
  cape: { description: "Cape flowing behind: heroes, villains, royalty." },
  backpack: { description: "Backpack: students, hikers, travellers." },
} as const satisfies Record<string, Entry>;

/** Drawing style of a cast member. */
export const STYLES = {
  ink: { description: "Ink lines with a paper-white head (or the cast's own line/fill colours)." },
  neon: { description: "Glowing neon tubes in the cast colour on a dark head. Best at night or with the neon grade." },
} as const satisfies Record<string, Entry>;

export type ActionId = keyof typeof ACTIONS;
export type ExpressionId = keyof typeof EXPRESSIONS;
export type BackgroundId = keyof typeof BACKGROUNDS;
export type PropId = keyof typeof PROPS;
export type CameraId = keyof typeof CAMERAS;
export type TransitionId = keyof typeof TRANSITIONS;
export type GradeId = keyof typeof GRADES;
export type CaptionId = keyof typeof CAPTIONS;
export type WeatherId = keyof typeof WEATHER;
export type FramingId = keyof typeof FRAMINGS;
export type OverlayId = keyof typeof OVERLAYS;
export type PositionId = keyof typeof POSITIONS;
export type AttachPointId = keyof typeof ATTACH_POINTS;
export type HatId = keyof typeof HATS;
export type HairId = keyof typeof HAIR;
export type BeardId = keyof typeof BEARDS;
export type FaceFeatureId = keyof typeof FACE_FEATURES;
export type BuildId = keyof typeof BUILDS;
export type OutfitId = keyof typeof OUTFITS;
export type StyleId = keyof typeof STYLES;

export const CATALOGUE = {
  actions: ACTIONS,
  expressions: EXPRESSIONS,
  backgrounds: BACKGROUNDS,
  props: PROPS,
  cameras: CAMERAS,
  transitions: TRANSITIONS,
  grades: GRADES,
  captions: CAPTIONS,
  weather: WEATHER,
  framings: FRAMINGS,
  overlays: OVERLAYS,
  positions: POSITIONS,
  attachPoints: ATTACH_POINTS,
  hats: HATS,
  hair: HAIR,
  beards: BEARDS,
  faceFeatures: FACE_FEATURES,
  builds: BUILDS,
  outfits: OUTFITS,
  styles: STYLES,
} as const;

export type CatalogueSection = keyof typeof CATALOGUE;

export function idsOf<S extends CatalogueSection>(section: S): (keyof (typeof CATALOGUE)[S] & string)[] {
  return Object.keys(CATALOGUE[section]) as (keyof (typeof CATALOGUE)[S] & string)[];
}
