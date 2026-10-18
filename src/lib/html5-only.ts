/**
 * True when playback can only go through the WebView's own <video> element:
 * the plain web build, and the iOS app, which ships no libmpv. Kept free of
 * imports so stream ranking code (also run under node tests) can use it.
 */
export function isHtml5OnlyRuntime(): boolean {
  if (typeof window === "undefined") return false;
  if (!("__TAURI_INTERNALS__" in window)) return true;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports a desktop Safari UA; touch points tell it apart from a Mac.
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** iOS app build (Tauri on iPhone / iPad). */
export function isIosApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && isHtml5OnlyRuntime();
}

/**
 * True only for the desktop Tauri shell: a resizable OS window with minimize,
 * maximize, close, drag regions and resize edges. False on iOS and the web.
 */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !isHtml5OnlyRuntime();
}

/**
 * "Compass VLC" iOS build: bundles a native (VLC) player for every format the
 * system player cannot open. Set by CI (VITE_IOS_NATIVE_PLAYER=1).
 */
export const IOS_NATIVE_BUILD = import.meta.env.VITE_IOS_NATIVE_PLAYER === "1";
