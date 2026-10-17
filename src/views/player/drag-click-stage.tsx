import { useRef, useState } from "react";
import { Sun } from "lucide-react";
import { isIosApp } from "@/lib/html5-only";
import { iosGetBrightness, iosLastBrightness, iosSetBrightness } from "@/lib/ios-media";

const IOS = isIosApp();
/** Fraction of the full range per pixel of trackpad scroll. ~250px = 0 → 100%. */
const WHEEL_STEP = 0.004;

export function DragClickStage(props: {
  drawMode: boolean;
  pipMode: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  /** `precise`: deltaY is a continuous amount (trackpad/touch), not wheel notches. */
  onWheelVolume?: (deltaY: number, precise?: boolean) => void;
}) {
  const { drawMode, pipMode, onClick, onDoubleClick, onWheelVolume } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const brightnessRef = useRef<number | null>(null);
  const [brightnessOsd, setBrightnessOsd] = useState<number | null>(null);
  const osdTimer = useRef<number | null>(null);
  const touch = useRef<{ x: number; y: number; lastY: number; side: "left" | "right"; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const sideOf = (clientX: number): "left" | "right" => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return "right";
    return clientX - rect.left < rect.width / 2 ? "left" : "right";
  };

  // iOS brightness: native screen brightness, with a small on-screen indicator.
  const nudgeBrightness = (amount: number) => {
    const apply = (base: number) => {
      const next = Math.min(1, Math.max(0, base + amount));
      brightnessRef.current = next;
      iosSetBrightness(next);
      setBrightnessOsd(next);
      if (osdTimer.current != null) window.clearTimeout(osdTimer.current);
      osdTimer.current = window.setTimeout(() => setBrightnessOsd(null), 900);
    };
    if (brightnessRef.current != null) return apply(brightnessRef.current);
    const known = iosLastBrightness();
    if (known != null) return apply(known);
    void iosGetBrightness().then((v) => apply(v ?? 0.5));
  };

  // Positive amount = up = louder / brighter.
  const adjust = (side: "left" | "right", amount: number) => {
    if (side === "left") nudgeBrightness(amount);
    else onWheelVolume?.(-amount / WHEEL_STEP, true);
  };

  return (
    <div
      ref={stageRef}
      data-player-click-stage
      className="pointer-events-auto absolute inset-0 z-[3]"
      onWheel={(e) => {
        if (drawMode || pipMode) return;
        if (e.ctrlKey || e.metaKey) return;
        if (!IOS) {
          onWheelVolume?.(e.deltaY);
          return;
        }
        // iPad trackpad, natural scrolling (the default): fingers up give a positive
        // deltaY. Fingers up should mean louder / brighter, like other iPad players.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        adjust(sideOf(e.clientX), e.deltaY * WHEEL_STEP);
      }}
      onTouchStart={(e) => {
        if (!IOS || drawMode || pipMode || e.touches.length !== 1) return;
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY, lastY: t.clientY, side: sideOf(t.clientX), active: false };
      }}
      onTouchMove={(e) => {
        const g = touch.current;
        if (!g || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!g.active) {
          const dx = Math.abs(t.clientX - g.x);
          const dy = Math.abs(t.clientY - g.y);
          if (dy < 12 || dy < dx * 1.5) return;
          g.active = true;
          g.lastY = t.clientY;
          return;
        }
        const height = stageRef.current?.clientHeight || window.innerHeight;
        // A full-height drag sweeps the whole range.
        adjust(g.side, (g.lastY - t.clientY) / height);
        g.lastY = t.clientY;
      }}
      onTouchEnd={() => {
        if (touch.current?.active) {
          // iOS may or may not follow a swipe with a synthetic click; swallow one if it does.
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 450);
        }
        touch.current = null;
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (drawMode || pipMode) return;
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startTime = Date.now();
        let dragStarted = false;
        const onMove = (ev: MouseEvent) => {
          if (dragStarted) return;
          if (Date.now() - startTime < 150) return;
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (dx > 8 || dy > 8) {
            dragStarted = true;
            if (IOS) return; // no OS window to drag on iPad
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            import("@tauri-apps/api/window")
              .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
              .catch(() => {});
          }
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (!dragStarted) onClick();
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (drawMode || pipMode) return;
        onDoubleClick();
      }}
    >
      {brightnessOsd != null && (
        <div className="pointer-events-none absolute start-8 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 rounded-full bg-black/55 px-2.5 py-3 text-white backdrop-blur-md">
          <Sun size={18} strokeWidth={2} />
          <div className="relative h-28 w-1.5 overflow-hidden rounded-full bg-white/25">
            <div
              className="absolute inset-x-0 bottom-0 rounded-full bg-white"
              style={{ height: `${Math.round(brightnessOsd * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
