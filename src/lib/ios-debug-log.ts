/**
 * iOS: keep the app's recent console output in memory so the loading screen can
 * show it (there is no developer console on a sideloaded iPad app). Only lines
 * from the player / picker / stream code are kept.
 */
type Line = { at: number; level: "log" | "warn" | "error"; text: string };

const MAX_LINES = 120;
const RELEVANT = /^\[(player|picker|html5|pipeline|resolve|rd-transcode|torbox|ios|stream|proxy|compass)/i;
const lines: Line[] = [];
const listeners = new Set<() => void>();
let installed = false;

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 400);
}

export function installIosDebugLog(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const text = stringify(args);
      if (!RELEVANT.test(text)) return;
      lines.push({ at: Date.now(), level, text });
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      for (const l of listeners) l();
    };
  }
}

export function recentDebugLines(sinceMs = 0): Line[] {
  return lines.filter((l) => l.at >= sinceMs);
}

export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
