"use client";

import { useState } from "react";

export interface ProviderCatalogItem {
  id: string;
  displayName: string;
  description: string;
  configured: boolean;
  requires: string[];
}

/**
 * Provider selection UI.
 * - Enabled providers can be toggled on/off per scan.
 * - Unconfigured providers are shown but locked, with a "Not configured" badge
 *   and the env var(s) needed to enable them.
 * - Wikimedia Commons (free, no key) is always available.
 */
export default function ProviderPicker({
  providers,
  selectedIds,
  onChange,
}: {
  providers: ProviderCatalogItem[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-neutral-800">
          Reverse search providers ({selectedIds.size} selected)
        </span>
        <span className="text-xs text-neutral-500">{open ? "▲ hide" : "▼ choose"}</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-2">
          {providers.map((provider) => {
            const checked = selectedIds.has(provider.id);
            return (
              <li key={provider.id}>
                <label
                  className={`flex items-start gap-3 rounded-md border p-2.5 transition ${
                    checked ? "border-blue-300 bg-white" : "border-transparent bg-white/60"
                  } ${provider.configured ? "cursor-pointer" : "opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                    checked={checked}
                    disabled={!provider.configured}
                    onChange={(event) => {
                      const next = new Set(selectedIds);
                      if (event.target.checked) next.add(provider.id);
                      else next.delete(provider.id);
                      onChange(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900">{provider.displayName}</span>
                      {provider.configured ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Ready
                        </span>
                      ) : (
                        <span
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          title={`Set ${provider.requires.join(", ")} in .env.local`}
                        >
                          Not configured
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                      {provider.description}
                      {!provider.configured && (
                        <span className="mt-0.5 block font-mono text-[10px] text-neutral-400">
                          requires: {provider.requires.join(", ")}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
