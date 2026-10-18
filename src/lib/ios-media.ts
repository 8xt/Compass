/**
 * System volume and screen brightness on iOS, through the native ios-media
 * plugin (src-tauri/plugins/ios-media). HTMLMediaElement.volume is read-only on
 * iOS, so the player's slider and gestures go through here instead.
 *
 * Setters are coalesced to one native call per animation frame: a trackpad
 * swipe produces dozens of wheel events, and only the latest value matters.
 */
import { invoke } from "@tauri-apps/api/core";
import { isIosApp } from "@/lib/html5-only";

type Kind = "Volume" | "Brightness";

const pending: Record<Kind, number | null> = { Volume: null, Brightness: null };
const scheduled: Record<Kind, boolean> = { Volume: false, Brightness: false };
const last: Record<Kind, number | null> = { Volume: null, Brightness: null };

function call(action: string, value?: number): Promise<number | null> {
  if (!isIosApp()) return Promise.resolve(null);
  return invoke<{ value?: number } | null>("ios_media", { action, value })
    .then((r) => (r && typeof r.value === "number" ? r.value : null))
    .catch(() => null);
}

function flush(kind: Kind) {
  scheduled[kind] = false;
  const value = pending[kind];
  pending[kind] = null;
  if (value == null) return;
  void call(`set${kind}`, value).then((applied) => {
    if (applied != null) {
      last[kind] = applied;
      if (Math.abs(applied - value) > 0.05) {
        console.warn(`[ios] ${kind.toLowerCase()} set ${value.toFixed(2)} but iOS reports ${applied.toFixed(2)}`);
      }
    }
  });
}

function set(kind: Kind, value: number) {
  const v = Math.min(1, Math.max(0, value));
  last[kind] = v;
  pending[kind] = v;
  if (scheduled[kind]) return;
  scheduled[kind] = true;
  requestAnimationFrame(() => flush(kind));
}

async function get(kind: Kind): Promise<number | null> {
  const v = await call(`get${kind}`);
  if (v != null) last[kind] = v;
  return v;
}

export const iosSetVolume = (v: number) => set("Volume", v);
export const iosGetVolume = () => get("Volume");
export const iosSetBrightness = (v: number) => set("Brightness", v);
export const iosGetBrightness = () => get("Brightness");

/** Last value this session set or read, without a native round trip. */
export const iosLastVolume = () => last.Volume;
export const iosLastBrightness = () => last.Brightness;

/** Opens the system AirPlay picker for the playing video. */
export function showAirPlayPicker(): boolean {
  const video = document.querySelector("video") as
    | (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void })
    | null;
  if (!video || typeof video.webkitShowPlaybackTargetPicker !== "function") return false;
  video.webkitShowPlaybackTargetPicker();
  return true;
}
