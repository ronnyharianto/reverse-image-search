"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ImageDetail from "@/components/ImageDetail";
import ImageResultList from "@/components/ImageResultList";
import ScanProgress from "@/components/ScanProgress";
import type { ImageScanResult, ScanProgress as ProgressData, ScanEvent, ScanSnapshot } from "@/types/scanner";

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [results, setResults] = useState<ImageScanResult[]>([]);
  const [selected, setSelected] = useState<ImageScanResult | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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
          if (!response.ok) return;
          const snapshot = (await response.json()) as ScanSnapshot;
          setProgress(snapshot.progress);
          setResults(snapshot.results);
          setSelected((prev) => (prev ? snapshot.results.find((r) => r.id === prev.id) ?? null : null));
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
        <span className="w-16" />
      </div>

      {connectionError ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {connectionError}
        </p>
      ) : null}

      {progress ? (
        <div className="space-y-6">
          <ScanProgress progress={progress} onStop={handleStop} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <ImageResultList results={results} onSelect={setSelected} selectedId={selected?.id} />
            <aside className="lg:sticky lg:top-6 h-fit">
              {selected ? (
                <ImageDetail result={selected} />
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
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-neutral-500">
          Connecting to scan stream…
        </div>
      )}
    </main>
  );
}
