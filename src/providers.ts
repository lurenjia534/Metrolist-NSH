import { batch, setColorScheme, setTheme, signal, Storage } from "nsh";
import * as playback from "./playback";
import { settings } from "./store";
import * as together from "./together";
import { pauseSpotify } from "./spotish/App";
import spotifyTheme from "./spotish/theme.json";

export type MusicProvider = "youtube" | "spotify";

export const activeProvider = signal<MusicProvider>("youtube");
export const providersReady = signal(false);
export const switchingProvider = signal(false);
export const providerError = signal("");

function applyProvider(provider: MusicProvider) {
  batch(() => {
    activeProvider.set(provider);
    playback.workspaceActive.set(provider === "youtube");
    setTheme(provider === "spotify" ? spotifyTheme : null);
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
