import { resolve } from "path";
import { pathToFileURL } from "url";

// Headless NSH tests have no process.dataDir. Their app manifest grants this
// real, private fixture directory, exercising the same file-read check.
export function mediaFile(name: string) {
  const destination = resolve("tests/local-media/media", name);
  return { destination, url: pathToFileURL(destination).href };
}
