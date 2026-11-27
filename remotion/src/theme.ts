/**
 * The look: one palette, one line weight, one way to shift colour by time of
 * day. Backgrounds are flat shapes with no outlines; characters are crisp ink
 * lines with a light halo. That contrast keeps the figures readable on any
 * background.
 */

export const W = 1920;
export const H = 1080;
export const FPS = 30;

export const INK = "#1d1b29";
export const PAPER = "#fbf4e6";
export const ACCENT = "#ffd166"; // lamp light, highlighted caption word

/**
 * Text never goes below this many px from the bottom: the lowest strip is
 * covered by the player's progress bar and controls (and Shorts UI later).
 */
export const SAFE_BOTTOM = 150;

/** Overall character size. Cast `scale` multiplies this (line weight stays the same). */
export const FIGURE_SCALE = 1.12;
export const LINE = 11; // character stroke width at scale 1
export const HALO = 7; // extra width each side of the stroke

export const C = {
  skyDayTop: "#7fbde6",
  skyDayBottom: "#d6eef6",
  skyDuskTop: "#3b3f78",
  skyDuskMid: "#c9708a",
  skyDuskBottom: "#f6b27a",
  skyNightTop: "#0b1230",
  skyNightBottom: "#26325c",
  sea: "#3c7aa6",
  seaDeep: "#2c5f88",
  foam: "#e6f3f7",
  grass: "#79b06a",
  grassDark: "#5a9259",
  pine: "#3f7a5c",
  pineDark: "#2d5c49",
  pineFar: "#7fa79a",
  rock: "#8f96a3",
  rockDark: "#6b7280",
  stone: "#b8b2a7",
  stoneDark: "#968f84",
  wall: "#efe2c8",
  wallShade: "#e2d1b1",
  wood: "#b5835a",
  woodDark: "#8a5d3d",
  woodLight: "#cf9f72",
  red: "#d0473d",
  redDark: "#a8352d",
  white: "#f6f1e7",
  rug: "#c4584a",
  rugLight: "#e0a24e",
  roof: "#5b6b8c",
  roofWarm: "#b9574a",
  cobble: "#a99f92",
  cobbleDark: "#8e8477",
  glass: "#bfe0ee",
} as const;

export type TimeOfDay = "day" | "dusk" | "night";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * Re-lights a base colour for the time of day: dusk pulls toward warm rose,
 * night toward deep blue and darker. Emissive things (lamps, lit windows)
 * skip this and stay bright.
 */
export function tone(hex: string, tod: TimeOfDay, interior = false): string {
  if (tod === "day") return hex;
  if (interior) return toneInterior(hex, tod);
  if (tod === "dusk") return mix(mix(hex, "#e07a6a", 0.22), "#3a2a4a", 0.18);
  return mix(mix(hex, "#1b2a5a", 0.55), "#0a0f22", 0.32);
}

/**
 * Indoors the light comes from lamps, not the sky, so night keeps its colour:
 * a tinted multiply (warm-violet shadows) instead of a mix toward navy, which
 * turned every interior the same grey. Dusk indoors is a gentle amber.
 */
function toneInterior(hex: string, tod: TimeOfDay): string {
  const [r, g, b] = hexToRgb(hex);
  const [kr, kg, kb] = tod === "dusk" ? [0.94, 0.8, 0.72] : [0.6, 0.47, 0.5];
  const lift = tod === "dusk" ? 6 : 8;
  return rgbToHex([r * kr + lift, g * kg + lift * 0.6, b * kb + lift * 1.8]);
}

export type Tone = (hex: string) => string;
export const toner = (tod: TimeOfDay, interior = false): Tone => (hex) => tone(hex, tod, interior);

/** Deterministic 0..1 hash of a string, for per-character phase offsets. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
