/**
 * iOS touch adaptations for a UI designed around a mouse.
 *
 * Long-press opens the app's right-click menus: WKWebView never fires
 * `contextmenu` for touches, so cards, rows and episodes would otherwise have no
 * way to reach "Add to list", "Mark watched" and the rest.
 */

const LONG_PRESS_MS = 480;
const MOVE_TOLERANCE_PX = 10;

let installed = false;

export function installIosTouchAdaptations(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let target: Element | null = null;
  let suppressClickUntil = 0;

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    target = null;
  };

  const isTextEntry = (el: Element | null) =>
    !!el?.closest("input, textarea, select, [contenteditable='true']");

  window.addEventListener(
    "touchstart",
    (e) => {
      cancel();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const el = e.target instanceof Element ? e.target : null;
      if (!el || isTextEntry(el)) return;
      startX = touch.clientX;
      startY = touch.clientY;
      target = el;
      timer = window.setTimeout(() => {
        timer = null;
        const node = target;
        target = null;
        if (!node || !node.isConnected) return;
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX,
          clientY: startY,
          screenX: startX,
          screenY: startY,
          button: 2,
          buttons: 2,
        });
        const handled = !node.dispatchEvent(event);
        if (handled) {
          // The finger lifting after a long-press must not also "click" the card.
          suppressClickUntil = Date.now() + 700;
          try {
            navigator.vibrate?.(10);
          } catch {
            /* not supported */
          }
        }
      }, LONG_PRESS_MS);
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (timer === null) return;
      const touch = e.touches[0];
      if (!touch) return cancel();
      if (
        Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
        Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
      ) {
        cancel();
      }
    },
    { capture: true, passive: true },
  );

  window.addEventListener("touchend", cancel, { capture: true, passive: true });
  window.addEventListener("touchcancel", cancel, { capture: true, passive: true });

  window.addEventListener(
    "click",
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntil = 0;
      }
    },
    true,
  );
}
