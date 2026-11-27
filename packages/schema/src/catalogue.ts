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
} as const satisfies Record<string, Entry & { kind: "loop" | "once"; travels: boolean }>;

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
} as const satisfies Record<string, Entry>;

export const BACKGROUNDS = {
  house_interior: { description: "Cosy keeper's cottage: wooden floor, window, shelf, rug, lamp.", interior: true },
  street: { description: "Small harbour-town street: houses, shop awning, lamp post, cobbles.", interior: false },
  forest: { description: "Pine forest path with layered trees and ferns.", interior: false },
  lighthouse_exterior: { description: "Red-and-white lighthouse on a rocky point above the sea.", interior: false },
  lighthouse_stairs: { description: "Inside the lighthouse: stone wall, spiral stairs rising, small round window.", interior: true },
} as const satisfies Record<string, Entry & { interior: boolean }>;

export const PROPS = {
  lantern: { description: "Hand lantern; glows at dusk and night. Attach to a hand.", placement: "hand" },
  oil_can: { description: "Metal oil can with a spout. Hand or ground.", placement: "hand_or_ground" },
  flour_sack: { description: "Sack of flour, slightly spilled. Ground.", placement: "ground" },
  footprints: { description: "Trail of adult boot prints on the ground, starting at pos.", placement: "ground" },
  small_footprints: { description: "Trail of small bare footprints on the ground, starting at pos.", placement: "ground" },
  bed: { description: "Simple wooden bed with blanket; a character at the same pos lies or sits on it.", placement: "ground" },
  ship: { description: "Cargo ship on the horizon, bobbing. Outdoor sea backgrounds.", placement: "horizon" },
  clock: { description: "Round wall clock with fast-ticking hands. Wall.", placement: "wall" },
} as const satisfies Record<string, Entry & { placement: string }>;

export const CAMERAS = {
  static: { description: "Locked-off camera. No movement." },
  slow_push: { description: "Slow push in toward the characters across the whole scene." },
  shake: { description: "Hard shake that settles into a light tremble. Impacts, panic." },
  zoom_face: { description: "Fast zoom onto the first character's face, then holds. Reactions, reveals." },
  dolly_out: { description: "Starts close, slowly pulls back to reveal the whole frame." },
} as const satisfies Record<string, Entry>;

export const TRANSITIONS = {
  cut: { description: "Straight cut." },
  whoosh_wipe: { description: "Fast diagonal wipe with a motion streak. Change of place." },
  smash_cut: { description: "Hard cut with a white flash and punch-in. Shock, reveals, comedy." },
  dip_to_black: { description: "Previous scene fades to black, this one fades up. Time skip." },
} as const satisfies Record<string, Entry>;

export const GRADES = {
  day: { description: "Bright daylight, light vignette.", timeOfDay: "day" },
  dusk: { description: "Warm orange sunset light.", timeOfDay: "dusk" },
  night: { description: "Cool blue night with a strong vignette; lamps glow.", timeOfDay: "night" },
} as const satisfies Record<string, Entry & { timeOfDay: "day" | "dusk" | "night" }>;

export const CAPTIONS = {
  word_pop: { description: "Big bold words at the bottom, popping in one by one; current word highlighted." },
  none: { description: "No captions for this scene." },
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
} as const satisfies Record<string, Entry>;

export type ActionId = keyof typeof ACTIONS;
export type ExpressionId = keyof typeof EXPRESSIONS;
export type BackgroundId = keyof typeof BACKGROUNDS;
export type PropId = keyof typeof PROPS;
export type CameraId = keyof typeof CAMERAS;
export type TransitionId = keyof typeof TRANSITIONS;
export type GradeId = keyof typeof GRADES;
export type CaptionId = keyof typeof CAPTIONS;
export type PositionId = keyof typeof POSITIONS;
export type AttachPointId = keyof typeof ATTACH_POINTS;
export type HatId = keyof typeof HATS;

export const CATALOGUE = {
  actions: ACTIONS,
  expressions: EXPRESSIONS,
  backgrounds: BACKGROUNDS,
  props: PROPS,
  cameras: CAMERAS,
  transitions: TRANSITIONS,
  grades: GRADES,
  captions: CAPTIONS,
  positions: POSITIONS,
  attachPoints: ATTACH_POINTS,
  hats: HATS,
} as const;

export type CatalogueSection = keyof typeof CATALOGUE;

export function idsOf<S extends CatalogueSection>(section: S): (keyof (typeof CATALOGUE)[S] & string)[] {
  return Object.keys(CATALOGUE[section]) as (keyof (typeof CATALOGUE)[S] & string)[];
}
