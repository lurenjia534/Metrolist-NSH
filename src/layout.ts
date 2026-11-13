// The YouTube Music workspace's arrangement, on the Spotify workspace's
// breakpoints (src/spotish/components/layout.ts): the desktop's sidebar (a
// rail on narrow windows), the player bar's three sizes, and the room a page
// leaves for the bar floating over it. Phones (and narrow browser windows)
// get one column, tabs and a mini player.

import { platform, signal, Storage, windowSize } from "nsh";

const mobile = platform.os === "android" || platform.os === "ios";
/** iOS and Android draw the stack's own header; the others draw the page's. */
export const systemHeader = mobile;
/** One column with tabs: a phone, or a window too small for the sidebar. */
export const phone = () => windowSize().width < 760 || mobile && windowSize().height < 600;
export type Layout = "desktop" | "phone";
export const layout = (): Layout => phone() ? "phone" : "desktop";

const RAIL = 860;
const ALBUM_COLUMN = 1100;
const RAIL_WIDTH = 72;
const SIDEBAR_MIDDLE = 228;
const SIDEBAR_WIDE = 274;
const SHELL_GAPS = 3 * 8;
const COMPACT_BAR = 760;
const STACKED_BAR = 520;

/** Folded away by the header's first button; remembered between runs. */
export const sidebarCollapsed = signal(false);
void Storage.getItem("metrolist.sidebar").then((value) => { if (value === "collapsed") sidebarCollapsed.set(true); }).catch(() => {});
export function toggleSidebar() {
  sidebarCollapsed.set(!sidebarCollapsed());
  void Storage.setItem("metrolist.sidebar", sidebarCollapsed() ? "collapsed" : "open");
}
export const sidebarShown = () => layout() === "desktop" && !sidebarCollapsed();
export const railSidebar = () => windowSize().width < RAIL;
export const sidebarWidth = () => !sidebarShown() ? 0 : railSidebar() ? RAIL_WIDTH : windowSize().width < ALBUM_COLUMN ? SIDEBAR_MIDDLE : SIDEBAR_WIDE;
/** The pages' room beside the sidebar. */
export const desktopPageWidth = () => windowSize().width - sidebarWidth() - (sidebarShown() ? SHELL_GAPS : 2 * 8);
export const barSize = (): "full" | "compact" | "stacked" => {
  const w = desktopPageWidth();
  return w < STACKED_BAR ? "stacked" : w < COMPACT_BAR ? "compact" : "full";
};
/** A narrow desktop searches in the page's own row. */
export const narrowDesktopHeader = () => layout() === "desktop" && desktopPageWidth() < 640;
/** Room for an album column in track lists. */
export const wideTracks = () => layout() === "desktop" && windowSize().width > ALBUM_COLUMN;
/** The room a page leaves at its end, clear of the floating player. */
export const pageEnd = () => layout() !== "desktop" ? "pb-8" : barSize() === "stacked" ? "pb-36" : "pb-28";
