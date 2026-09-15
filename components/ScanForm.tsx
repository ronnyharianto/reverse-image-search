"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProviderPicker, {
  type ProviderCatalogItem,
} from "@/components/ProviderPicker";
import {
  loadStoredSelection,
  mergeStoredSelection,
  saveStoredSelection,
} from "@/lib/provider-selection";

interface SavedScanWarning {
  message: string;
  savedScanId: string;
}

export default function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<ProviderCatalogItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savedWarning, setSavedWarning] = useState<SavedScanWarning | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("failed")),
      )
      .then((payload: { providers?: ProviderCatalogItem[] }) => {
        if (cancelled || !payload.providers) return;
        setProviders(payload.providers);
        // Restore the last-used selection when valid; otherwise pre-check the
        // defaults (Wikimedia Commons only). Opt-in providers stay unchecked
        // until selected, even when their credentials are configured.
        setSelectedIds(
          new Set(
            mergeStoredSelection(loadStoredSelection(), payload.providers),
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        // Picker stays hidden when the catalog is unavailable; scans then omit
        // the provider field and use the server default (Wikimedia Commons only).
        setProviders([]);
        setSelectedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist the selection so the next visit starts from it. */
  function handleSelectionChange(next: Set<string>) {
    setSelectedIds(next);
    saveStoredSelection(Array.from(next));
  }

  async function startScan(fresh: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omit `providers` when the catalog never loaded → server-side default
        // (Wikimedia Commons only). `fresh: true` skips the saved-result warning.
        body: JSON.stringify({
          url,
          fresh,
          ...(providers.length > 0
            ? { providers: Array.from(selectedIds) }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        scanId?: string;
        warning?: string;
        message?: string;
        savedScanId?: string;
        error?: string;
      };
      if (
        response.status === 409 &&
        payload.warning === "saved-scan-exists" &&
        payload.savedScanId
      ) {
        // A saved result for this URL exists — let the user decide.
        setSavedWarning({
          message: payload.message ?? "A saved result exists for this URL.",
          savedScanId: payload.savedScanId,
        });
        return;
      }
      if (!response.ok || !payload.scanId) {
        setError(payload.error ?? "Could not start the scan.");
        return;
      }
      router.push(`/scan/${payload.scanId}`);
    } catch {
      setError("Could not reach the scanner API. Is the dev server running?");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedWarning(null);
    await startScan(false);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      <label
        htmlFor="url"
        className="block text-sm font-medium text-neutral-700"
      >
        Website URL
      </label>
      <input
        id="url"
        name="url"
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="https://example.com"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setSavedWarning(null);
        }}
        required
        className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-3 text-base text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
      />
      <button
        type="submit"
        disabled={submitting || url.trim().length === 0}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {submitting ? "Starting scan…" : "Start Scan"}
      </button>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {savedWarning ? (
        <div
          role="alertdialog"
          aria-label="Saved scan found"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p className="font-semibold">⚠ Saved result found</p>
          <p className="mt-1 leading-relaxed">{savedWarning.message}</p>
          <div className="mt-3 flex justify-around gap-2">
            <button
              type="button"
              onClick={() =>
                router.push(`/scan/${savedWarning.savedScanId}?saved=1`)
              }
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              Show last result
            </button>
            <button
              type="button"
              onClick={() => {
                setSavedWarning(null);
                void startScan(true);
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              Scan fresh
            </button>
            <button
              type="button"
              onClick={() => setSavedWarning(null)}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-neutral-500 transition hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {providers.length > 0 ? (
        <ProviderPicker
          providers={providers}
          selectedIds={selectedIds}
          onChange={handleSelectionChange}
        />
      ) : null}
      <p className="text-xs leading-relaxed text-neutral-500">
        This is a copyright-risk <strong>screening</strong> tool. It does not
        determine whether an image legally infringes copyright. Only public
        http(s) websites can be scanned.
      </p>
    </form>
  );
}
