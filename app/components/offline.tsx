export function WorkerOffline({ error, offline }: { error: string; offline: boolean }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <p className="eyebrow text-danger">{offline ? "Worker offline" : "Couldn't load"}</p>
      <h1 className="title-card mt-3 text-title">{offline ? "The studio machine isn't listening" : "Something went wrong"}</h1>
      <p className="mt-4 text-muted">{error}</p>
      {offline && (
        <p className="mt-6 text-muted">
          Start it in a terminal at the repo root, then reload:
          <code className="mt-3 block rounded-md bg-raised px-4 py-3 font-mono text-sm text-text">pnpm worker</code>
        </p>
      )}
    </div>
  );
}
