import { currentRing, isHot, noteWorker } from "@/lib/doorbell";
import { isWorker } from "@/lib/tokens";

// Answers from the runtime cache alone. This route must never query the
// database: its whole purpose is to let an idle worker leave Neon asleep.
export async function GET(request: Request) {
  if (!isWorker(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = (request.headers.get("x-worker-id") ?? "").slice(0, 200);
  const kinds = (request.headers.get("x-worker-kinds") ?? "").split(",").filter(Boolean).slice(0, 8);
  const [ring, hot] = await Promise.all([
    currentRing(), isHot().catch(() => false), id ? noteWorker(id, kinds) : Promise.resolve()]);
  return Response.json({ ring, hot }, { headers: { "Cache-Control": "no-store" } });
}
