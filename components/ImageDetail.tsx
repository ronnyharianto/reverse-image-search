"use client";

import { useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { categorizeSourceUrl } from "@/lib/match-categorization";
import { MATCH_CATEGORY_STYLES, type MatchCategory } from "@/lib/match-categorization";
import { hasFailedProviderLookup, PROVIDER_LABELS } from "@/types/scanner";
import type { ImageScanResult } from "@/types/scanner";

/** Friendly provider name for badges; falls back to the raw provider id. */
function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

export default function ImageDetail({
  result,
  onRetry,
  retryDisabled = false,
}: {
  result: ImageScanResult;
  onRetry?: (result: ImageScanResult) => void;
  /** True while the scan is running — retries must wait for completion. */
  retryDisabled?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900">Image Detail</h2>

      <div className="mb-4 flex items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        {result.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={result.previewUrl} alt="Image preview" className="max-h-72 w-auto rounded object-contain" />
        ) : (
          <p className="text-sm text-neutral-400">No preview available</p>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-neutral-500">Status</dt>
          <dd className="mt-1">
            <StatusBadge status={result.status} />
          </dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-500">Remark</dt>
          <dd className="mt-1 text-neutral-800">{result.remark}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-500">Page URL</dt>
          <dd className="mt-1 break-all text-blue-700">
            {result.pageUrl ? (
              <a href={result.pageUrl} target="_blank" rel="noopener noreferrer nofollow">
                {result.pageUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-500">Image URL</dt>
          <dd className="mt-1 break-all text-blue-700">
            {result.imageUrl ? (
              <a href={result.imageUrl} target="_blank" rel="noopener noreferrer nofollow">
                {result.imageUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {result.width && result.height ? (
          <div className="flex gap-6">
            <div>
              <dt className="font-medium text-neutral-500">Dimensions</dt>
              <dd className="mt-1 text-neutral-800">
                {result.width} × {result.height}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-500">Size</dt>
              <dd className="mt-1 text-neutral-800">
                {result.byteSize ? `${(result.byteSize / 1024).toFixed(0)} KB` : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-500">Type</dt>
              <dd className="mt-1 text-neutral-800">{result.mimeType ?? "—"}</dd>
            </div>
          </div>
        ) : null}
        {result.occurrences.length > 1 ? (
          <div>
            <dt className="font-medium text-neutral-500">
              Found on {result.occurrences.length} page
              {result.occurrences.length === 1 ? "" : "s"}
            </dt>
            <dd className="mt-1 space-y-1">
              {result.occurrences.map((occurrence) => (
                <p key={`${occurrence.pageUrl}-${occurrence.imageUrl}`} className="break-all text-neutral-700">
                  {occurrence.pageUrl}
                </p>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <h3 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Reverse Search Results
      </h3>
      {result.reverseSearchResults && result.reverseSearchResults.length > 0 ? (
        <ol className="space-y-2">
          {result.reverseSearchResults.map((match, index) => {
            const category: MatchCategory = match.category ?? categorizeSourceUrl(match.sourceUrl);
            const style = MATCH_CATEGORY_STYLES[category];
            return (
              <li key={`${match.sourceUrl}-${index}`} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-neutral-900">
                    {index + 1}. {match.sourceName}
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.classes}`}
                    title={style.hint}
                  >
                    {style.label}
                  </span>
                </div>
                <a
                  href={match.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all text-sm text-blue-700 hover:underline"
                >
                  {match.sourceUrl}
                </a>
                {match.similarity !== undefined ? (
                  <p className="text-sm text-neutral-600">Similarity: {match.similarity}%</p>
                ) : null}
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">{style.hint}</p>
                <p className="mt-1 text-xs text-neutral-500">via {providerLabel(match.providerId)}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-neutral-500">
          {result.status === "NO_MATCH"
            ? "No matching image found by the configured providers."
            : result.status === "REQUIRES_REVIEW"
              ? "No provider searched this image. Manual verification required."
              : "No reverse search results available."}
        </p>
      )}

      {result.providerOutcomes && result.providerOutcomes.length > 0 ? (
        <>
          <h3 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Provider Search Summary
          </h3>
          <ul className="space-y-2">
            {result.providerOutcomes.map((outcome) => {
              const label = providerLabel(outcome.providerId);
              const badge = outcome.searched
                ? outcome.status === "MATCH_FOUND"
                  ? { text: `${outcome.matchCount} match${outcome.matchCount === 1 ? "" : "es"}`, classes: "border-amber-200 bg-amber-50 text-amber-900" }
                  : { text: "No match", classes: "border-emerald-200 bg-emerald-50 text-emerald-800" }
                : { text: "Failed", classes: "border-red-200 bg-red-50 text-red-700" };
              return (
                <li key={outcome.providerId} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-neutral-900">{label}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.classes}`}>
                      {badge.text}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">{outcome.remark}</p>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {onRetry && (result.status === "FAILED" || hasFailedProviderLookup(result)) ? (
        <button
          type="button"
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry(result);
            } finally {
              setRetrying(false);
            }
          }}
          disabled={retryDisabled || retrying}
          title={
            retryDisabled
              ? "Wait for the scan to finish before retrying."
              : "Run the failed reverse search again."
          }
          className="mt-6 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry lookup"}
          {retryDisabled ? " (scan in progress)" : ""}
        </button>
      ) : null}

      <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
        Screening hint only: a match means the image exists elsewhere. It does not establish copyright
        ownership or infringement. Verify the source and license manually.
      </p>
    </section>
  );
}
