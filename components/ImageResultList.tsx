"use client";

import { useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { MATCH_CATEGORY_STYLES, summarizeMatchCategories } from "@/lib/match-categorization";
import { hasFailedProviderLookup, type ImageScanResult } from "@/types/scanner";

function truncateUrl(url: string, max = 60): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

function UrlList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <span className="text-neutral-400">{emptyText}</span>;
  }
  if (items.length <= 2) {
    return (
      <div className="space-y-0.5">
        {items.map((url) => (
          <p key={url} className="break-all text-neutral-700" title={url}>
            {truncateUrl(url, 70)}
          </p>
        ))}
      </div>
    );
  }
  return <ExpandableUrlList items={items} />;
}

function ExpandableUrlList({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-0.5">
      {items.slice(0, 2).map((url) => (
        <p key={url} className="break-all text-neutral-700" title={url}>
          {truncateUrl(url, 70)}
        </p>
      ))}
      {expanded
        ? items.slice(2).map((url) => (
            <p key={url} className="break-all text-neutral-700" title={url}>
              {truncateUrl(url, 70)}
            </p>
          ))
        : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(!expanded);
        }}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        {expanded ? "− show less" : `+ ${items.length - 2} more`}
      </button>
      </div>
  );
}

export default function ImageResultList({
  results,
  onSelect,
  selectedId,
  onRetry,
  retryingId,
  retryDisabled = false,
}: {
  results: ImageScanResult[];
  onSelect: (result: ImageScanResult) => void;
  selectedId?: string;
  /** Starts a retry of the failed provider lookup for one row. */
  onRetry?: (result: ImageScanResult) => void;
  /** Row currently being retried (shows a spinner state on its button). */
  retryingId?: string | null;
  /** True while the scan is running — retries must wait for completion. */
  retryDisabled?: boolean;
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
                <th className="px-3 py-3 font-medium">Page URL(s)</th>
                <th className="px-3 py-3 font-medium">Image URL(s)</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Remark</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((result, index) => {
                const pages = [...new Set(result.occurrences.map((o) => o.pageUrl))];
                const images = [...new Set(result.occurrences.map((o) => o.imageUrl))];
                const categories = summarizeMatchCategories(result.reverseSearchResults ?? []);
                const retryable = result.status === "FAILED" || hasFailedProviderLookup(result);
                const isRetrying = retryingId === result.id;
                return (
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
                    <td className="max-w-[18rem] px-3 py-3">
                      <UrlList items={pages} emptyText="—" />
                    </td>
                    <td className="max-w-[18rem] px-3 py-3">
                      <UrlList items={images} emptyText="—" />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={result.status} />
                      {categories.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {categories.map((category) => {
                            const style = MATCH_CATEGORY_STYLES[category];
                            return (
                              <span
                                key={category}
                                className={`rounded border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.classes}`}
                                title={style.hint}
                              >
                                {style.short}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {retryable && onRetry ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRetry(result);
                          }}
                          disabled={retryDisabled || isRetrying}
                          title={
                            retryDisabled
                              ? "Wait for the scan to finish before retrying."
                              : "Run the failed reverse search again."
                          }
                          className="mt-1.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRetrying ? "Retrying…" : "Retry lookup"}
                        </button>
                      ) : null}
                    </td>
                    <td className="max-w-[20rem] px-5 py-3 text-neutral-600">{result.remark}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
