import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Fredoka 700 (SIL OFL, public/fonts/Fredoka-OFL.txt), vendored so renders work offline.
export const fontsReady = loadFont({ family: "Fredoka", url: staticFile("fonts/Fredoka-700.woff2"), weight: "700" });
