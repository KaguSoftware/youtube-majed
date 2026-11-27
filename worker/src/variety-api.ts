/**
 * The variety guard over HTTP (Phase 5, Part B), for the Storyboard and Export pages. Code only, nothing queued:
 * the report is computed from the projects' files on every request (a few milliseconds).
 *
 *   GET /projects/:id/variety[?against=N]   {report, storyboard}   the report as the project is now (null without a storyboard), and
 *                                                                 what its last storyboard run asked for and changed (variety.json)
 *   GET /variety[?against=N]                VarietyAllFile          every storyboarded project against the videos before it
 */
import { projectPaths } from "@studio/project";
import { VARIETY_AGAINST } from "@studio/schema";
import { existsSync } from "node:fs";
import { StoryError } from "./story";
import { readVarietyFile } from "./storyboard";
import { varietyAll, varietyReport } from "./variety";

type Handler = (req: { url: URL }, m: string[]) => Promise<unknown> | unknown;

function against(url: URL): number | undefined {
  const raw = url.searchParams.get("against");
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < VARIETY_AGAINST.min || n > VARIETY_AGAINST.max) throw new StoryError(`against is ${VARIETY_AGAINST.min} to ${VARIETY_AGAINST.max}`);
  return n;
}

export function varietyRoutes(): [string, RegExp, Handler][] {
  return [
    [
      "GET",
      /^\/projects\/([\w-]+)\/variety$/,
      (req, [id]) => {
        if (!existsSync(projectPaths(id!).dir)) throw Object.assign(new Error(`no project ${id}`), { status: 404 });
        return { report: varietyReport(id!, { against: against(req.url) }) ?? null, storyboard: readVarietyFile(id!) ?? null };
      },
    ],
    ["GET", /^\/variety$/, (req) => varietyAll({ against: against(req.url) })],
  ];
}
