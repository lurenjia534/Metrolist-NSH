// Adapted for Metrolist NSH; see third-party/spotish/README.md.
// The app's one backend, chosen once: the native engine on the desktops and
// in a terminal, official Spotify SDKs on web/phones. The demo is selected
// only by `host.params.backend === "demo"` for tests. The engine gets the
// bridge script shipped with this bundle, so an OTA update can fix it.

import { host, platform, signal } from "nsh";
import { DemoBackend, type DemoOptions } from "../backend/demo";
import { enrich } from "../backend/fixtures";
import { engineBackend, EngineBackend } from "../backend/engine";
import { hostBackend, HostBackend } from "../backend/host";
import { BRIDGE_SOURCE } from "../bridge/source";
import type { Backend } from "../backend/types";

const DEMO_KEY = "__spotishDemo";

function params(): Record<string, unknown> {
  try {
    return (host.params ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function demo(p: Record<string, unknown>): Backend {
  const g = globalThis as unknown as Record<string, DemoBackend | undefined>;
  let backend = g[DEMO_KEY];
  if (!backend) {
    const options: DemoOptions = {};
    if (typeof p.premium === "boolean") options.premium = p.premium;
    if (typeof p.signedIn === "boolean") options.signedIn = p.signedIn;
    if (typeof p.ad === "boolean") options.ad = p.ad;
    if (typeof p.latency === "number") options.latency = p.latency;
    if (p.demo === "rich") enrich();
    backend = new DemoBackend(options);
    g[DEMO_KEY] = backend;
  }
  return backend;
}

function choose(): Backend {
  const p = params();
  if (p.backend === "demo") return demo(p);
  if (platform.os !== "web" && platform.os !== "ios" && platform.os !== "android") {
    const engine = engineBackend();
    engine.setBridge(BRIDGE_SOURCE);
    return engine;
  }
  return hostBackend();
}

/** The backend every store goes through. */
export const backend: Backend = choose();

/** Whether the music is the demo's. */
export const isDemo = backend.kind === "demo";

/** Whether this workspace accepts new playback intents. */
export const workspaceActive = signal(false);

/** Called when the Spotify workspace first becomes visible. */
export async function activateSpotify(): Promise<void> {
  workspaceActive.set(true);
  if (backend instanceof EngineBackend || backend instanceof HostBackend) await backend.activate();
}

export async function deactivateSpotify(): Promise<void> {
  if (backend instanceof HostBackend) await backend.deactivate();
}

/** The browser/phone account connection, including its public app ID. */
export const connectedBackend = backend instanceof HostBackend ? backend : null;
export const canSetVolume = () => connectedBackend ? connectedBackend.capabilities().volume : true;
