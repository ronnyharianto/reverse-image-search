"use client";

import { useMemo } from "react";
import { MATCH_CATEGORY_ORDER, MATCH_CATEGORY_STYLES } from "@/lib/match-categorization";
import type { ImageScanResult } from "@/types/scanner";

/**
 * Scan-wide roll-up of match-source categories:
 * how many images matched sources of each kind, e.g.
 * "2 images matched commercial stock · 5 matched free media libraries".
 * Screening aid only — never a legal conclusion.
 */
export default function MatchCategorySummary({ results }: { results: ImageScanResult[] }) {
  const counts = useMemo(() => {
    const perCategory = new Map<string, number>();
    let imagesWithMatches = 0;
    for (const result of results) {
      const categories = new Set(
        (result.reverseSearchResults ?? []).map((m) => m.category ?? "OTHER_SOURCE"),
      );
      if (categories.size === 0) continue;
      imagesWithMatches += 1;
      for (const category of categories) {
        perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
      }
    }
    return { perCategory, imagesWithMatches };
  }, [results]);

  if (counts.imagesWithMatches === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        Match sources — {counts.imagesWithMatches} image{counts.imagesWithMatches === 1 ? "" : "s"} with matches
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {MATCH_CATEGORY_ORDER.filter((category) => counts.perCategory.get(category)).map((category) => {
          const style = MATCH_CATEGORY_STYLES[category];
          return (
            <span key={category} className="flex items-center gap-1.5 text-sm" title={style.hint}>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.classes}`}>
                {style.short}
              </span>
              <span className="text-neutral-700">
                {counts.perCategory.get(category)} image{counts.perCategory.get(category) === 1 ? "" : "s"}
              </span>
            </span>
          );
        })}
        <span className="text-xs text-neutral-400">Verify sources before any use — categories are hints, not verdicts.</span>
      </div>
    </div>
  );
}
