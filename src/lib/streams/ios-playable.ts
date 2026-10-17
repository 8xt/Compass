import { isIosApp } from "@/lib/html5-only";
import { isCached } from "./cached";
import type { DebridSlug, RankedPicker, ScoredStream, Tier } from "./types";

/**
 * How likely the iOS system player (WebKit <video>) is to open a stream.
 *   3: MP4/MOV/M4V/WebM/TS/HLS with audio iOS decodes
 *   2: container unknown (no extension), audio fine
 *   1: AV1 (newest iPads only)
 *   0: MKV/AVI/WMV, x265 not known to be MP4, or DTS / TrueHD audio: will not play
 */
export function iosPlayability(s: ScoredStream): number {
  const audio = s.audio?.codec;
  if (audio === "DTS" || audio === "DTS-HD MA" || audio === "TrueHD") return 0;
  const name = `${s.behaviorHints?.filename ?? ""} ${s.url ?? ""}`.toLowerCase();
  const ext = (name.split("?")[0].match(/\.([a-z0-9]{2,4})(?:\s|$)/) ?? [])[1];
  const container = s.container ?? (ext as ScoredStream["container"]) ?? null;
  if (container === "mkv" || container === "avi" || container === "wmv") return 0;
  if (s.codec === "AV1") return 1;
  // x265 releases from debrid/torrents are almost always MKV; only HEVC that is
  // known to be in MP4/MOV plays on iPad.
  if (s.codec === "HEVC" && container !== "mp4" && container !== "m4v" && container !== "mov") return 0;
  if (
    container === "mp4" ||
    container === "m4v" ||
    container === "mov" ||
    container === "webm" ||
    container === "ts" ||
    name.includes(".m3u8")
  ) {
    return 3;
  }
  return 2;
}

/**
 * On iOS, move streams the system player can open ahead of ones it cannot,
 * keeping the existing order within each group. Elsewhere the picker is
 * returned unchanged.
 */
export function iosPlayableFirst(picker: RankedPicker, activeDebrids: DebridSlug[]): RankedPicker {
  if (!isIosApp() || picker.all.length === 0) return picker;
  const score = new Map(picker.all.map((s) => [s, iosPlayability(s)] as const));
  const all = picker.all
    .map((s, i) => ({ s, i }))
    .sort((a, b) => score.get(b.s)! - score.get(a.s)! || a.i - b.i)
    .map(({ s }) => s);
  const byTier: Partial<Record<Tier, ScoredStream>> = {};
  const cachedFirst = all
    .map((s, i) => ({ s, i, c: isCached(s, activeDebrids) ? 1 : 0 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map(({ s }) => s);
  for (const s of cachedFirst) if (!byTier[s.tier]) byTier[s.tier] = s;
  const best = all.find((s) => isCached(s, activeDebrids)) ?? null;
  const primary =
    picker.primary && best && score.get(picker.primary)! >= score.get(best)! ? picker.primary : best;
  return { ...picker, all, byTier, primary };
}
