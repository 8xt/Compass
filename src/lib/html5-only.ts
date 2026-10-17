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
