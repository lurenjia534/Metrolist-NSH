// Adapted for Metrolist NSH; see third-party/spotish/README.md.
// The app's entry: picks the shell for the window (desktop, phone or
// terminal), and mounts what shows over every shell (Now Playing, About,
// the sign-in prompt, the first-run sheet and the toasts) and the keyboard
// shortcuts, and installs the desktop integration (`src/platform`). Pages
// and state live under `src/`.

import { cleanup, keymap, Text, View } from "nsh";
import { layout } from "./components/layout";
import { NowPlayingSheet } from "./components/player/now-playing";
import { Toaster } from "./components/ui/feedback";
import { TitleBar } from "./components/ui/title-bar";
import { AboutDialog, FirstRunSheet, ShortcutsDialog, SigningInDialog } from "./pages/dialogs";
import { bindRegionKeys } from "./components/ui/regions";
import { DesktopShell } from "./shells/desktop";
import { PhoneShell } from "./shells/phone";
import { TerminalShell } from "./shells/terminal";
import { installDesktopShell } from "./platform/desktop";
import { installMediaControls } from "./platform/media";
import { followSystemTheme } from "./platform/theme";
import { positionAt } from "./backend/types";
import { activateSpotify, backend, isDemo, workspaceActive } from "./state/engine";
import { setNowPlayingOpen, setShortcutsOpen } from "./state/overlays";
import { next, pause, pauseForWorkspaceSwitch, play, player, previous, seek, toggle } from "./state/player";

/** The Spotify tray, system media controls and system theme exist only
 * while this workspace is selected. The root application owns updates. */
function installPlatform() {
  const shell = installDesktopShell({
    isPlaying: () => player().playing,
    title: () => {
      const p = player();
      return p.title ? (p.artist ? `${p.title} · ${p.artist}` : p.title) : "";
    },
    togglePlay: toggle,
    next,
    previous,
    showNowPlaying: () => setNowPlayingOpen(true),
  });
  installMediaControls({
    // The position where it is now, so the system's own clock runs on from it.
    player: () => {
      const p = player();
      return { ...p, positionMs: positionAt(p, Date.now()) };
    },
    toggle,
    play,
    pause,
    next,
    previous,
    seek,
    raise: shell.showWindow,
  });
  followSystemTheme();
}

function Shortcuts() {
  // Media-style keys that leave text editing alone: none of them fires
  // while a text input has the focus. Escape belongs to the overlays.
  cleanup(keymap.bind("space", () => toggle(), { when: "notEditing" }));
  cleanup(keymap.bind("mod+shift+right", () => next(), { when: "notEditing" }));
  cleanup(keymap.bind("mod+shift+left", () => previous(), { when: "notEditing" }));
  // Ctrl and an arrow move between the window's regions; `?` lists the keys.
  bindRegionKeys();
  cleanup(keymap.bind("shift+/", () => setShortcutsOpen(true), { when: "notEditing" }));
  return <View class="hidden" />;
}

/** An independent Spotify workspace; the application's provider selector
 * mounts it and supplies its theme. Module stores keep navigation and data. */
export function SpotifyWorkspace() {
  void activateSpotify();
  if (!isDemo) installPlatform();
  return (
    <View testID="spotify-workspace" class="min-h-0 min-w-0 flex-1 bg-sidebar">
      <If when={isDemo}>
        <View testID="spotify-demo-banner" class="shrink-0 gap-1 border-b border-border bg-accent px-4 py-2">
          <Text class="text-xs font-semibold text-accent-foreground">Spotify 预览 · 示例数据</Text>
          <Text class="text-xs text-muted-foreground">此处可体验界面和动画；真实播放请使用桌面版并登录 Spotify。</Text>
        </View>
      </If>
      <Shortcuts />
      {/* The desktop shell keeps only its columns under the window controls
          clear of them; the others start below the whole title bar. */}
      <If when={layout() !== "desktop"}>
        <TitleBar />
      </If>
      <If when={layout() === "desktop"}>
        <DesktopShell />
      </If>
      <If when={layout() === "phone"}>
        <PhoneShell />
      </If>
      <If when={layout() === "terminal"}>
        <TerminalShell />
      </If>
      <NowPlayingSheet />
      <AboutDialog />
      <ShortcutsDialog />
      <SigningInDialog />
      <FirstRunSheet />
      <Toaster bottomOffset={layout() === "desktop" ? 96 : 140} />
    </View>
  );
}

/** The selector awaits this before moving to YouTube Music, so a pending
 * play request cannot start Spotify after the other service becomes active. */
export async function pauseSpotify(): Promise<void> {
  workspaceActive.set(false);
  try {
    if (backend.health().status === "signingIn") await backend.cancelSignIn();
    await pauseForWorkspaceSwitch();
  } catch (error) {
    workspaceActive.set(true);
    throw error;
  }
}

export { activateSpotify };

