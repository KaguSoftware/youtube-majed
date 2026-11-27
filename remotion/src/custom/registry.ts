import type { ComponentType } from "react";
import type { ShotProps } from "./types";

/**
 * Custom shot components by the hash of their source. The files are staged
 * into ./.staged/<hash>.tsx right before a render or a check bundles
 * (packages/project/src/custom-shots.ts), so a bundle holds exactly the shots
 * of the project being drawn. Only the Remotion entry files import this module
 * (StoryVideo takes the components as a prop), because `require.context` is
 * webpack's and exists in the Remotion bundle and nowhere else.
 * (`import.meta.webpackContext` is not an option: Remotion serves its bundle as a classic script.)
 */
type Context = { keys(): string[]; (key: string): { default?: ComponentType<ShotProps> } };
type WebpackRequire = { context(dir: string, deep: boolean, filter: RegExp): Context };

const staged: Context | undefined = typeof require === "undefined" ? undefined : (require as unknown as WebpackRequire).context("./.staged", false, /\.tsx$/);

export function shotComponent(hash: string): ComponentType<ShotProps> {
  const key = `./${hash}.tsx`;
  if (!staged || !staged.keys().includes(key)) throw new Error(`custom shot ${hash} is not staged in this bundle`);
  const Component = staged(key).default;
  if (!Component) throw new Error(`custom shot ${hash} has no default export`);
  return Component;
}
