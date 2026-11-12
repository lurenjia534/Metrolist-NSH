// Headless tests run a Linux native crate. Route only the iOS bridge seam to
// the explicit test host, retaining HostBackend and its real Web API mappings.
import { host, platform, Storage } from "nsh";
import { SpotifyMobile } from "metrolist/native";

// Page-host calls are outside AppHost.calls(), which only records the local
// handlers override. Preserve the host's own recording for protocol assertions.
host.on("test.calls", value => { void Storage.setItem("test.spotify.calls", JSON.stringify(value)); });

if (platform.os === "ios") {
  SpotifyMobile.prototype.request = async function(method: string, payload: string): Promise<string> {
    return JSON.stringify(await host.call(`app.spotify.${method}`, JSON.parse(payload)));
  };
  SpotifyMobile.prototype.onEvent = function(listener: (snapshot: string) => void): () => void {
    return host.on("app.spotify.state", value => listener(JSON.stringify(value)));
  };
}
