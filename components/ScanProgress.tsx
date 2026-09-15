import { PROVIDER_LABELS, type ScanProgress } from "@/types/scanner";

/** Locale date-time for display; "—" for missing/invalid values. */
function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export default function ScanProgress({
  progress,
  onStop,
}: {
  progress: ScanProgress;
  onStop?: () => void;
}) {
  const running = progress.state === "RUNNING";

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Target</p>
          <p className="font-medium break-all text-neutral-900">{progress.targetUrl}</p>
          {progress.providers && progress.providers.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-500">Search via:</span>
              {progress.providers.map((providerId) => (
                <span
                  key={providerId}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600"
                  title={PROVIDER_LABELS[providerId] ?? providerId}
                >
                  {PROVIDER_LABELS[providerId] ?? providerId}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
              running
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : progress.state === "COMPLETED"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : progress.state === "STOPPED"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {running && <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
            {running ? "Scanning…" : progress.state === "COMPLETED" ? "Completed" : progress.state === "STOPPED" ? "Stopped" : "Failed"}
          </span>
          {running && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 sm:gap-6">
        <div className="rounded-lg bg-neutral-50 p-3">
          <dt className="text-xs text-neutral-500">Pages scanned</dt>
          <dd className="text-2xl font-semibold text-neutral-900">{progress.pagesScanned}</dd>
        </div>
        <div className="rounded-lg bg-neutral-50 p-3">
          <dt className="text-xs text-neutral-500">Images found</dt>
          <dd className="text-2xl font-semibold text-neutral-900">{progress.imagesFound}</dd>
        </div>
        <div className="rounded-lg bg-neutral-50 p-3">
          <dt className="text-xs text-neutral-500">Images processed</dt>
          <dd className="text-2xl font-semibold text-neutral-900">{progress.imagesProcessed}</dd>
        </div>
      </dl>

      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
        <span>
          Started: <time dateTime={progress.startedAt} className="font-medium text-neutral-700">{formatDateTime(progress.startedAt)}</time>
        </span>
        <span>
          Finished: {""}
          {progress.finishedAt ? (
            <time dateTime={progress.finishedAt} className="font-medium text-neutral-700">{formatDateTime(progress.finishedAt)}</time>
          ) : (
            <span className="text-neutral-400">{running ? "in progress…" : "—"}</span>
          )}
        </span>
      </p>

      {running && (progress.currentPage || progress.currentImage) ? (
        <div className="mt-4 space-y-1 text-sm text-neutral-600">
          {progress.currentPage ? (
            <p className="truncate">
              <span className="font-medium text-neutral-800">Current page: </span>
              <span className="break-all">{progress.currentPage}</span>
            </p>
          ) : null}
          {progress.currentImage ? (
            <p className="truncate">
              <span className="font-medium text-neutral-800">Current image: </span>
              <span className="break-all">{progress.currentImage}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
