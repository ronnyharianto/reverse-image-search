"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ImageDetail from "@/components/ImageDetail";
import ImageResultList from "@/components/ImageResultList";
import MatchCategorySummary from "@/components/MatchCategorySummary";
import ScanProgress from "@/components/ScanProgress";
import type { ImageScanResult, ScanProgress as ProgressData, ScanEvent, ScanSnapshot } from "@/types/scanner";

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [results, setResults] = useState<ImageScanResult[]>([]);
  const [selected, setSelected] = useState<ImageScanResult | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // True after the user left the read-only saved view via the Edit button.
  const [savedViewDismissed, setSavedViewDismissed] = useState(false);

  useEffect(() => {
    params.then((p) => setScanId(p.id));
  }, [params]);

  const applyResult = useCallback((incoming: ImageScanResult) => {
    setResults((current) => {
      const index = current.findIndex((r) => r.id === incoming.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = incoming;
        return next;
      }
      return [...current, incoming];
    });
  }, []);

  // SSE subscription
  useEffect(() => {
    if (!scanId) return;
    let source: EventSource | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const startPollingFallback = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const response = await fetch(`/api/scan/${scanId}`);
          if (response.status === 404) {
            // The live scan is gone (server restart or prune) — stop polling
            // immediately; the saved-snapshot fallback takes over below.
            clearInterval(pollTimer);
            pollTimer = undefined;
            return;
          }
          if (!response.ok) return;
          const snapshot = (await response.json()) as ScanSnapshot;
          setProgress(snapshot.progress);
          setResults(snapshot.results);
          setSelected((prev) => (prev ? snapshot.results.find((r) => r.id === prev.id) ?? null : null));
          // The scan is over — stop polling instead of looping forever.
          if (snapshot.progress.state !== "RUNNING" && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
          }
        } catch {
          // ignore transient polling errors
        }
      }, 2000);
    };

    try {
      source = new EventSource(`/api/scan/${scanId}/stream`);
      source.onmessage = (event) => {
        const scanEvent = JSON.parse(event.data) as ScanEvent;
        if (scanEvent.type === "progress") {
          setProgress(scanEvent.progress);
        } else if (scanEvent.type === "result") {
          applyResult(scanEvent.result);
        } else if (scanEvent.type === "done") {
          setProgress(scanEvent.progress);
          source?.close();
          if (pollTimer) clearInterval(pollTimer);
        } else if (scanEvent.type === "error") {
          setConnectionError(scanEvent.message);
        }
      };
      source.onerror = () => {
        // SSE failed (proxy, restart); fall back to polling the snapshot API
        source?.close();
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }

    return () => {
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [scanId, applyResult]);

  const handleStop = useCallback(async () => {
    if (!scanId) return;
    await fetch(`/api/scan/${scanId}/stop`, { method: "POST" }).catch(() => undefined);
  }, [scanId]);

  // Retry the failed reverse-search lookup of one image; the refreshed row
  // arrives from the response and replaces the stale one in the list.
  const handleRetry = useCallback(
    async (result: ImageScanResult): Promise<void> => {
      if (!scanId || progress?.state === "RUNNING") return;
      setRetryingId(result.id);
      try {
        const response = await fetch(`/api/scan/${scanId}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultId: result.id }),
        });
        const payload = (await response.json().catch(() => null)) as { result?: ImageScanResult; error?: string } | null;
        if (!response.ok || !payload?.result) {
          setConnectionError(payload?.error ?? "Retry failed. Please try again.");
          return;
        }
        const refreshed = payload.result;
        applyResult(refreshed);
        setSelected((prev) => (prev && prev.id === refreshed.id ? refreshed : prev));
        setConnectionError(null);
      } catch {
        setConnectionError("Retry failed. Please try again.");
      } finally {
        setRetryingId(null);
      }
    },
    [scanId, progress?.state, applyResult],
  );

  // Saved view mode: derived from the URL (?saved=1, set by "Show last result")
  // rather than an effect, so no extra state or render pass is needed.
  const savedView = scanId !== null && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("saved") === "1";

  // Leave the read-only saved view: drop ?saved=1 from the URL (so a reload
  // keeps the editable mode) and flip local state immediately, in case the
  // soft navigation does not re-render this component.
  const discardSavedView = useCallback(() => {
    if (!scanId) return;
    setSavedViewDismissed(true);
    router.replace(`/scan/${scanId}`, { scroll: false });
  }, [router, scanId]);

  // Saved-snapshot fallback: when the URL carries ?saved=1 (opened from the
  // "Show last result" action) or the live scan is gone (server restarted),
  // load the persisted JSON and render it read-only.
  useEffect(() => {
    if (!scanId || progress) return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const wantsSaved = params.get("saved") === "1";
    const timer = setTimeout(() => {
      if (cancelled || progress) return;
      fetch(`/api/scan/${scanId}/saved`)
        .then(async (response) => {
          if (response.status === 404) return null;
          return response.ok ? ((await response.json()) as { snapshot?: { progress?: ProgressData; results?: ImageScanResult[] } } | null) : null;
        })
        .then((payload) => {
          if (cancelled || progress) return;
          if (payload?.snapshot?.progress) {
            setProgress(payload.snapshot.progress);
            setResults(payload.snapshot.results ?? []);
            return;
          }
          // No live scan (the poller got a 404 or SSE failed) and no saved
          // snapshot either — say so instead of hanging on "Connecting…".
          setConnectionError(
            "This scan is no longer available on the server (it may have restarted), " +
              "and no saved result was found for it. Start a new scan from the home page.",
          );
        })
        .catch(() => undefined);
    }, wantsSaved ? 0 : 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId, progress]);

  const isSavedView = savedView && !savedViewDismissed && progress !== null && progress.state !== "RUNNING";

  // Persist the finished scan as JSON under data/results/ and download it.
  const handleSave = useCallback(async () => {
    if (!scanId) return;
    setSaveState("saving");
    try {
      const response = await fetch("/api/scan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId }),
      });
      if (!response.ok) {
        setSaveState("error");
        return;
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "scan-result.json";
      link.click();
      URL.revokeObjectURL(downloadUrl);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [scanId]);

  if (!scanId) {
    return <main className="flex min-h-screen items-center justify-center text-neutral-500">Loading scan…</main>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← New scan
        </Link>
        <h1 className="text-xl font-semibold text-neutral-900">Copyright Image Scanner</h1>
        {progress && progress.state !== "RUNNING" && !isSavedView ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed — retry" : "Save results (JSON)"}
          </button>
        ) : (
          <span className="w-16" />
        )}
      </div>

      {/* Screening-tool disclaimer: must be visible on every scan view. */}
      <div
        role="note"
        aria-label="Manual verification disclaimer"
        className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <strong className="font-bold">
          ⚠️ This tool does not decide whether an image is safe to use.
        </strong>{" "}
        It is a screening aid, not a legal authority — every result still
        requires <strong>manual verification</strong>: open the reported
        sources and check the license and attribution terms yourself.
      </div>

      {connectionError ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {connectionError}
        </p>
      ) : null}

      {progress ? (
        <div className="space-y-6">
          {isSavedView ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              <p>
                Viewing a saved result (loaded from <code>data/results/</code>). Start a new scan from the home page
                to re-check this website.
              </p>
              <button
                type="button"
                onClick={discardSavedView}
                title="Exit the read-only view to retry failed provider lookups."
                className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
              >
                Edit
              </button>
            </div>
          ) : null}
          <ScanProgress progress={progress} onStop={isSavedView ? undefined : handleStop} />
          <MatchCategorySummary results={results} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <ImageResultList
              results={results}
              onSelect={setSelected}
              selectedId={selected?.id}
              onRetry={isSavedView ? undefined : handleRetry}
              retryingId={retryingId}
              retryDisabled={progress.state === "RUNNING"}
            />
            <aside className="lg:sticky lg:top-6 h-fit">
              {selected ? (
                <ImageDetail result={selected} onRetry={isSavedView ? undefined : handleRetry} retryDisabled={progress.state === "RUNNING"} />
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
                  Click a result row to inspect the image, its status, remark and reverse search sources.
                </div>
              )}
              {selected ? (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-50"
                >
                  Close detail
                </button>
              ) : null}
            </aside>
          </div>
        </div>
      ) : connectionError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-800">
          Scan unavailable — see the message above.
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-neutral-500">
          Connecting to scan stream…
        </div>
      )}
    </main>
  );
}
