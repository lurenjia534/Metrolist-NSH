// A cover's colours for the music light (spotish `coverColorsQuery`), read
// from the artwork's pixels by the Rust palette on every native platform and
// by the browser host's canvas on the web. Kept by artwork URL.

import { host, platform, resource, type Accessor } from "nsh";
import { NativeArtwork } from "metrolist/native";

const known = new Map<string, string[]>();
const loading = new Map<string, Promise<string[]>>();
const KEPT = 200;

function load(url: string): Promise<string[]> {
  let request = loading.get(url);
  if (!request) {
    request = (platform.os === "web" ? host.call<string[]>("app.coverColors", { imageUrl: url }) : NativeArtwork.colors(url))
      .then((colors) => {
        known.set(url, colors);
        while (known.size > KEPT) known.delete(known.keys().next().value as string);
        return colors;
      })
      .finally(() => loading.delete(url));
    loading.set(url, request);
  }
  return request;
}

/** A cover's colours (`#rrggbb`), most telling first, or [] while they are
 * not known or the cover has none: the light falls back on the theme. */
export function coverColorsQuery(image: () => string): Accessor<string[]> {
  const loaded = resource(
    () => image() || null,
    (url) => {
      const colors = known.get(url);
      return colors ? { url, colors } : load(url).then((value) => ({ url, colors: value }), () => ({ url, colors: [] as string[] }));
    },
  );
  return () => (loaded()?.url === image() ? loaded()!.colors : []);
}
