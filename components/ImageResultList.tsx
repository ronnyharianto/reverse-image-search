"use client";

import { useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import type { ImageScanResult } from "@/types/scanner";

export default function ImageResultList({
  results,
  onSelect,
  selectedId,
}: {
  results: ImageScanResult[];
  onSelect: (result: ImageScanResult) => void;
  selectedId?: string;
}) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const visible = onlyFlagged
    ? results.filter((r) => r.status === "MATCH_FOUND" || r.status === "REQUIRES_REVIEW")
    : results;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-neutral-900">
          Scan Results <span className="text-sm font-normal text-neutral-500">({results.length})</span>
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(event) => setOnlyFlagged(event.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          Show flagged only
        </label>
      </header>

      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          {results.length === 0 ? "Waiting for the first images to be processed…" : "No flagged images."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Image</th>
                <th className="px-3 py-3 font-medium">Page URL</th>
                <th className="px-3 py-3 font-medium">Image URL</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Remark</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((result, index) => (
                <tr
                  key={result.id}
                  onClick={() => onSelect(result)}
                  className={`cursor-pointer border-b border-neutral-100 transition hover:bg-blue-50 ${
                    selectedId === result.id ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="px-5 py-3 text-neutral-500">{index + 1}</td>
                  <td className="px-3 py-3">
                    {result.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={result.previewUrl}
                        alt=""
                        className="h-12 w-16 rounded border border-neutral-200 bg-neutral-50 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-16 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-[10px] text-neutral-400">
                        {result.status === "FAILED" ? "n/a" : "…"}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-3 text-neutral-700" title={result.pageUrl}>
                    {result.pageUrl || "—"}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-3 text-neutral-700" title={result.imageUrl}>
                    {result.imageUrl || "—"}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={result.status} />
                  </td>
                  <td className="max-w-[20rem] px-5 py-3 text-neutral-600">{result.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
