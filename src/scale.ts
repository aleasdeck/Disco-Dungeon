// The interface's size on a big screen. Its pieces are laid out in CSS pixels for a 1920 × 1080 screen, and on a 2K or
// 4K monitor at 100 % (a player's 2560 × 1440) they came out small while the room, the menu's hall and the mouse pointer
// grow with the window. So past 1920 × 1080 everything but those three is zoomed by --k (style.css) to take the same
// part of the screen as it does on 1080p; a smaller window (a laptop, a phone) is left exactly as it was.
// CSS zoom grows vw and vh along with the rest, so style.css writes those as var(--vw), var(--vh) and the like, which
// take the zoom back out. Lengths taken off the screen (getBoundingClientRect, the mouse, the room's figures) are the
// screen's own pixels: ui() turns them into the zoomed interface's pixels before they go into its styles.

const BASE_W = 1920, BASE_H = 1080;

/** How much the interface is zoomed now: 1 up to a 1920 × 1080 window, 4/3 on a 2560 × 1440 one. */
export let zoom = 1;

/** Screen pixels to the zoomed interface's CSS pixels. */
export const ui = (px: number) => px / zoom;

/**
 * Zoom is only used where the browser does it the way this file counts on: it grows vw and lengths alike, and boxes
 * on the screen come back in the screen's own pixels (Chromium, so the desktop build too, and Firefox). Elsewhere the
 * interface stays as it was.
 */
function works() {
  if (!CSS.supports('zoom', '2')) return false;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;width:10vw;height:10px;zoom:2;visibility:hidden;pointer-events:none';
  document.documentElement.append(el);
  const r = el.getBoundingClientRect();
  el.remove();
  return Math.abs(r.width - innerWidth * 0.2) < 2 && Math.abs(r.height - 20) < 0.5;
}

// outside a page (the tests run the game's code in Node) there is nothing to zoom
const page = typeof document !== 'undefined', ok = page && works();

function fit() {
  const k = ok ? Math.max(1, Math.min(innerWidth / BASE_W, innerHeight / BASE_H)) : 1;
  zoom = Math.round(k * 1000) / 1000;
  document.documentElement.style.setProperty('--k', String(zoom));
}

if (page) {
  fit();
  // first among the window's resize listeners (main.ts imports this before anything else), so the rest see the new zoom
  addEventListener('resize', fit);
}
