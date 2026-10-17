/**
 * iOS: an HLS version of a source that iPad's player can open, produced by the
 * user's debrid service (TorBox web streaming or Real-Debrid's Apple transcode).
 * Used for MKV / x265 / DTS files, which iOS cannot play directly.
 */
import type { EpisodeHint } from "@/lib/streams/episode-file";
import { realDebridAppleStream } from "./rd-transcode";
import { torboxAppleStream } from "./torbox";

export type AppleStreamKeys = { rdKey?: string; tbKey?: string };

export function hasAppleStreamKey(keys: AppleStreamKeys): boolean {
  return !!(keys.tbKey || keys.rdKey);
}

export async function iosAppleStream(
  keys: AppleStreamKeys,
  source: {
    url?: string | null;
    headers?: Record<string, string>;
    infoHash?: string | null;
    fileIdx?: number | null;
    hint?: EpisodeHint;
  },
  signal?: AbortSignal,
): Promise<string | null> {
  if (keys.tbKey) {
    const tb = await torboxAppleStream(keys.tbKey, source, signal).catch(() => null);
    if (tb) return tb;
  }
  if (keys.rdKey && source.url) {
    const rd = await realDebridAppleStream(keys.rdKey, source.url, source.headers).catch(() => null);
    if (rd) return rd;
  }
  return null;
}
