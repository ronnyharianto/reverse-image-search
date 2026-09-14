"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ScanForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as { scanId?: string; error?: string };
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

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      <label htmlFor="url" className="block text-sm font-medium text-neutral-700">
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
        onChange={(event) => setUrl(event.target.value)}
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
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-relaxed text-neutral-500">
        This is a copyright-risk <strong>screening</strong> tool. It does not determine whether an image
        legally infringes copyright. Only public http(s) websites can be scanned.
      </p>
    </form>
  );
}
