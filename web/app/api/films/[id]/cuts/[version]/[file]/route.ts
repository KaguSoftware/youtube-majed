import { getUser } from "@/lib/auth";
import { getCut } from "@/lib/cuts";
import { mediaUrl, mediaUrls } from "@/lib/media";

/*
 * One cut of a film as HLS (pipeline/assemble.py): a video playlist of its
 * chunks, one per shot, and the narration as a separate audio playlist,
 * joined by a master playlist. Written per request from the cut's chunk list
 * with fresh presigned URLs (signed locally, ~1 ms each), so the browser
 * fetches every chunk straight from the store: nothing streams through here,
 * and the store answers cross-origin GETs (measured, PLAN.md 12.2).
 *
 * Every chunk carries its own film time in its timestamps, so the playlists
 * need no discontinuities and the narration lines up by construction.
 */

const TYPE = "application/vnd.apple.mpegurl";

export async function GET(_request: Request, ctx: RouteContext<"/api/films/[id]/cuts/[version]/[file]">) {
  if (!(await getUser())) return new Response("unauthorized", { status: 401 });
  const { id, version, file } = await ctx.params;
  const cut = await getCut(id, Number(version));
  if (!cut?.hls) return new Response("no such cut", { status: 404 });
  const hls = cut.hls;
  let body: string;

  if (file === "master.m3u8") {
    // A hint for the player's buffer, not a limit: the film encodes at about
    // 17 MB a minute (pipeline/assemble.py FILM_VIDEO), ~2.3 Mbit/s, plus
    // the 96 kbit/s narration, with headroom for busy shots.
    const bandwidth = 3_500_000;
    body = [
      "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS",
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="voice",NAME="Narration",DEFAULT=YES,AUTOSELECT=YES,URI="narration.m3u8"`,
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${hls.width}x${hls.height},` +
        `CODECS="${hls.codecs}",AUDIO="voice"`,
      "video.m3u8", "",
    ].join("\n");
  } else if (file === "video.m3u8") {
    const urls = await mediaUrls(hls.chunks.map((c) => c.key));
    const longest = Math.max(...hls.chunks.map((c) => c.frames)) / hls.fps;
    body = [
      "#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(longest)}`,
      "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0",
      ...hls.chunks.flatMap((c) => [`#EXTINF:${(c.frames / hls.fps).toFixed(5)},`, urls[c.key]]),
      "#EXT-X-ENDLIST", "",
    ].join("\n");
  } else if (file === "narration.m3u8") {
    // One file in the store, read in ~6 s byte ranges so playback starts
    // after the first slice. Cuts made before the slices play it whole.
    const url = await mediaUrl(hls.narration);
    const slices = hls.narration_slices ?? [[hls.duration, 0, 0]];
    const whole = !hls.narration_slices;
    body = [
      "#EXTM3U", `#EXT-X-VERSION:${whole ? 3 : 4}`,
      `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...slices.map((x) => x[0])))}`,
      "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0",
      ...slices.flatMap(([seconds, length, offset]) => [
        `#EXTINF:${seconds.toFixed(5)},`, ...(whole ? [] : [`#EXT-X-BYTERANGE:${length}@${offset}`]), url]),
      "#EXT-X-ENDLIST", "",
    ].join("\n");
  } else {
    return new Response("not found", { status: 404 });
  }
  // The URLs inside expire within the hour, so the playlist is never cached.
  return new Response(body, { headers: { "Content-Type": TYPE, "Cache-Control": "private, no-store" } });
}
