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
  console.warn(
    `[ios] apple stream: tb=${!!keys.tbKey} rd=${!!keys.rdKey} hash=${source.infoHash ? "yes" : "no"} url=${source.url ? source.url.slice(0, 70) : "none"}`,
  );
  if (keys.tbKey) {
    const tb = await torboxAppleStream(keys.tbKey, source, signal).catch((e) => {
      console.warn("[torbox] apple stream threw", e);
      return null;
    });
    console.warn(`[torbox] apple stream -> ${tb ? "HLS ok" : "none"}`);
    if (tb) return tb;
  }
  if (keys.rdKey && source.url) {
    const rd = await realDebridAppleStream(keys.rdKey, source.url, source.headers).catch((e) => {
      console.warn("[rd-transcode] threw", e);
      return null;
    });
    console.warn(`[rd-transcode] apple stream -> ${rd ? "HLS ok" : "none"}`);
    if (rd) return rd;
  }
  return null;
}
