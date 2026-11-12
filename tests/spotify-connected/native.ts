// Headless tests run a Linux native crate. Route only the iOS bridge seam to
// the explicit test host, retaining HostBackend and its real Web API mappings.
import { host, platform } from "nsh";
import { SpotifyMobile } from "metrolist/native";

if (platform.os === "ios") {
  SpotifyMobile.prototype.request = async function(method: string, payload: string): Promise<string> {
    return JSON.stringify(await host.call(`app.spotify.${method}`, JSON.parse(payload)));
  };
  SpotifyMobile.prototype.onEvent = function(listener: (snapshot: string) => void): () => void {
    return host.on("app.spotify.state", value => listener(JSON.stringify(value)));
  };
}
