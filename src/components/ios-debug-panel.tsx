import { useEffect, useRef, useState } from "react";
import { isIosApp } from "@/lib/html5-only";
import { recentDebugLines, subscribeDebugLog } from "@/lib/ios-debug-log";

/**
 * iOS: when loading takes long, show what the app has been doing since this
 * screen appeared, so a screenshot is enough to diagnose a stuck source.
 */
export function IosDebugPanel({ delayMs = 10_000 }: { delayMs?: number }) {
  // Auto-play retries remount this screen; keep the last few minutes visible.
  const mountedAt = useRef(Date.now() - 180_000);
  const [visible, setVisible] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    if (!isIosApp()) return;
    const t = window.setTimeout(() => setVisible(true), delayMs);
    const off = subscribeDebugLog(() => force((n) => n + 1));
    return () => {
      window.clearTimeout(t);
      off();
    };
  }, [delayMs]);
  if (!isIosApp() || !visible) return null;
  const lines = recentDebugLines(mountedAt.current).slice(-14);
  return (
    <div className="pointer-events-auto absolute inset-x-4 bottom-24 z-[90] mx-auto max-w-3xl select-text rounded-xl bg-black/75 p-3 font-mono text-[10.5px] leading-snug text-white/80 ring-1 ring-white/10 backdrop-blur-md">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
        Diagnostics · screenshot this if it stays stuck
      </div>
      {lines.length === 0 ? (
        <div className="text-white/50">No player activity recorded yet.</div>
      ) : (
        lines.map((l, i) => (
          <div
            key={i}
            className={`break-all ${l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-200" : ""}`}
          >
            {new Date(l.at).toLocaleTimeString([], { hour12: false })} {l.text}
          </div>
        ))
      )}
    </div>
  );
}
