import { getScanEntry, subscribeToScan } from "@/lib/scan/scan-store";
import type { ScanEvent } from "@/types/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE stream of scan events.
 * Emits an initial snapshot of all results, then live progress/result events,
 * and closes the stream after the scan finishes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getScanEntry(id);
  if (!entry) {
    return new Response("Scan not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ScanEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream already closed by the client
        }
      };

      // Initial state so late joiners catch up instantly
      send({ type: "progress", progress: { ...entry.progress } });
      for (const result of entry.results) {
        send({
          type: "result",
          result: {
            ...result,
            occurrences: result.occurrences.map((o) => ({ ...o })),
            reverseSearchResults: result.reverseSearchResults?.map((m) => ({ ...m })),
          },
        });
      }

      if (entry.progress.state !== "RUNNING") {
        send({ type: "done", progress: { ...entry.progress } });
        controller.close();
        closed = true;
        return;
      }

      unsubscribe = subscribeToScan(entry, send);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          // ignore
        }
      }, 15_000);

      // Auto-close when the scan finishes
      const finishWatcher = setInterval(() => {
        if (entry.progress.state !== "RUNNING") {
          send({ type: "done", progress: { ...entry.progress } });
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }, 1_000);

      const cleanup = () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        if (finishWatcher) clearInterval(finishWatcher);
        closed = true;
      };
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
