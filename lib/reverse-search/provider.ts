/**
 * Reverse image search abstraction.
 *
 * The scan engine depends only on `ReverseImageSearchProvider`; concrete
 * providers (Wikimedia Commons, BYO-key endpoints) plug in behind it.
 */

import type { MatchSource } from "@/types/scanner";

export interface ImageInput {
  /** Raw image bytes. */
  data: Buffer;
  mimeType: string;
  /** SHA-1 of the bytes — used by hash-lookup providers. */
  sha1: string;
  /** SHA-256 of the bytes. */
  sha256: string;
  /** Source page URL, when known (some providers require a source). */
  pageUrl?: string;
}

export type ProviderResult =
  | {
      searched: true;
      status: "NO_MATCH" | "MATCH_FOUND";
      remark: string;
      matches: MatchSource[];
    }
  | { searched: false; status: "FAILED"; remark: string };

export interface ReverseImageSearchProvider {
  readonly id: string;
  readonly displayName: string;
  /** Short description of what this provider actually searches. */
  readonly description: string;
  search(image: ImageInput): Promise<ProviderResult>;
}
