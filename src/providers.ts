import { batch, setColorScheme, setTheme, signal, Storage } from "nsh";
import * as playback from "./playback";
import { settings } from "./store";
import * as together from "./together";
import { pauseSpotify } from "./spotish/App";
import spotifyTheme from "./spotish/theme.json";
import youtubeTheme from "../theme.json";

/** Pure black: the workspace's dark roles with every surface darker. */
const blackTheme = {
  ...youtubeTheme, name: "metrolist-black",
  cssVars: { ...youtubeTheme.cssVars, dark: { ...youtubeTheme.cssVars.dark,
    background: "#000000", sidebar: "#000000", shell: "#000000", card: "#0a0b0c", popover: "#0d0e0f", player: "#0b0c0d",
    secondary: "#141617", muted: "#1c1f21", border: "#1a1d1f", "sidebar-border": "#141617", "row-hover": "#0f1112", input: "#1f2224" } },
};

/** The YouTube Music workspace's theme for the user's choice. */
export function applyWorkspaceTheme(choice: string) {
  if (activeProvider() !== "youtube") return;
  setTheme(choice === "black" ? blackTheme : null);
}

export type MusicProvider = "youtube" | "spotify";

export const activeProvider = signal<MusicProvider>("youtube");
export const providersReady = signal(false);
export const switchingProvider = signal(false);
export const providerError = signal("");

function applyProvider(provider: MusicProvider) {
  batch(() => {
    activeProvider.set(provider);
    playback.workspaceActive.set(provider === "youtube");
    setTheme(provider === "spotify" ? spotifyTheme : settings().theme === "black" ? blackTheme : null);
    const theme = settings().theme;
    setColorScheme(provider === "spotify" ? "system" : theme === "black" ? "dark" : theme);
  });
}

/** Restore the workspace after the device's YouTube playback has reconnected. */
export async function initializeProviders() {
  try {
    const saved = await Storage.getItem("metrolist.provider");
    if (saved === "spotify") playback.pause();
    applyProvider(saved === "spotify" ? "spotify" : "youtube");
  } catch (error) {
    providerError.set(String(error));
  } finally {
    providersReady.set(true);
  }
}

/** Pause the outgoing service while keeping each service's navigation and queue. */
export async function selectProvider(provider: MusicProvider) {
  if (provider === activeProvider() || switchingProvider()) return;
  switchingProvider.set(true);
  providerError.set("");
  try {
    if (activeProvider() === "spotify") {
      await pauseSpotify();
    } else {
      // A listening room must not start YouTube again behind the Spotify workspace.
      if (together.connection() !== "disconnected") await together.disconnect();
      playback.pause();
    }
    applyProvider(provider);
    await Storage.setItem("metrolist.provider", provider);
  } catch (error) {
    providerError.set(error instanceof Error ? error.message : String(error));
  } finally {
    switchingProvider.set(false);
  }
}
