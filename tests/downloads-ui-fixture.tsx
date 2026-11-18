import { host, mount, platform, Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { NativeFiles } from "metrolist/native";
import { DownloadsPage } from "../src/pages/Downloads";
import { Dialogs } from "../src/components/Dialogs";
import { SettingsPage } from "../src/pages/Settings";
import * as s from "../src/store";
import * as p from "../src/playback";
import * as nav from "../src/navigation";
import type { DownloadJob, DownloadStatus, Track } from "../src/model";
import { resolvePlayback } from "../src/api";
import { mediaFile } from "./local-media/files";

NativeFiles.reveal = destination => host.call("app.test.files.reveal", { destination });

function job(id: string, title: string, artist: string, status: DownloadStatus, count: number): DownloadJob {
  const track: Track = { id, title, artist, album: "Offline sessions", artwork: "", duration: 180, source: "audio", url: `https://audio.test/${id}.m4a` };
  return { id, track, status, quality: "auto", bytes: count, totalBytes: status === "downloading" ? count * 2 : count,
    progress: status === "completed" ? 1 : status === "downloading" ? 0.5 : 0, name: `${title}.m4a`,
    url: status === "completed" ? platform.os === "web" ? `local:${id}` : mediaFile(`${id}.wav`).url : undefined,
    destination: status === "completed" ? platform.os === "web" ? `${id}.m4a` : mediaFile(`${id}.wav`).destination : undefined,
    error: status === "failed" ? "Fixture transfer failed" : undefined, createdAt: 1, updatedAt: 1 };
}

function Fixture() {
  const page = signal("downloads");
  s.settings.update(value => ({ ...value, apiBase: "", autoRadio: false }));
  s.downloadJobs.set([
    job("moon-one", "Moonlight", "Luna", "completed", 1048576),
    job("moon-two", "Moonrise", "Luna", "completed", 2097152),
    job("sun", "Sunrise", "Sol", "completed", 1048576),
    job("moon-failed", "Moonfall", "Luna", "failed", 0),
    job("sun-failed", "Sunset", "Sol", "failed", 0),
    job("moon-active", "Moonwalk", "Luna", "downloading", 524288),
    job("sun-active", "Solar wind", "Sol", "downloading", 1048576),
    job("cancelled", "Nightfall", "Nox", "cancelled", 0),
  ]);
  const rows = s.downloadJobs();
  const sun = rows.find(row => row.id === "sun")!;
  s.downloadJobs.set(rows.map(row => row.id === sun.id ? { ...sun, quality: "low", track: { ...sun.track, source: "youtube", url: undefined } } : row));
  const missing = { ...rows[0].track, id: "missing", title: "Missing", url: "https://audio.test/missing.m4a" };
  s.playlists.set([{ id: "nights", name: "Night set", createdAt: 1, updatedAt: 1,
    tracks: [rows[0].track, sun.track, rows[5].track, missing, missing, { ...missing, id: "file", url: "file:///file.mp3" }] },
    { id: "saved", name: "Saved set", createdAt: 2, updatedAt: 2, tracks: [] }]);
  s.listenEvents.set(["sun", "moon-two", "sun"].map((trackId, index) => ({ id: String(index), trackId, startedAt: index + 1, seconds: 20 })));
  p.initPlayback({ resolveStream: track => resolvePlayback(track) });
  nav.settingsSection.set("network");
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <View style={{ flexDirection: "row", gap: 12 }}><Button onPress={() => page.set("downloads")}><Text>Downloads</Text></Button><Button onPress={() => page.set("settings")}><Text>Connections</Text></Button></View>
    <Text testID="fixture-queue">{JSON.stringify(p.queue().map(track => track.id))}</Text>
    <Text testID="fixture-downloads">{JSON.stringify(s.downloadJobs().map(item => ({ id: item.id, status: item.status })))}</Text>
    <Scroll testID="fixture-scroll" style={{ flex: 1 }}><If when={page() === "downloads"} else={<SettingsPage />}><DownloadsPage /></If></Scroll>
    <Dialogs />
  </View>;
}

mount(Fixture);
