// Browser file storage and operating-system media controls. Playback is NSH AudioPlayer.
export function createHost(shell) {
  const objectURLs = new Map();
  const downloads = new Map();
  let database;
  let installPrompt;

  function openDatabase() {
    database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("metrolist-audio", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
        if (!request.result.objectStoreNames.contains("metadata")) request.result.createObjectStore("metadata");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }
  async function saveFile(id, file, metadata) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["files", "metadata"], "readwrite");
      tx.objectStore("files").put(file, id);
      tx.objectStore("metadata").put({ ...metadata, bytes: file.size, savedAt: Date.now() }, id);
      tx.oncomplete = () => {
        if (objectURLs.has(id)) { URL.revokeObjectURL(objectURLs.get(id)); objectURLs.delete(id); }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
  async function readFile(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function resolveFile(id) {
    if (!objectURLs.has(id)) {
      const file = await readFile(id);
      if (!file) throw new Error("这首音频已从设备移除，请重新下载或导入");
      objectURLs.set(id, URL.createObjectURL(file));
    }
    return { url: objectURLs.get(id) };
  }
  async function removeFile(id) {
    const db = await openDatabase();
    if (objectURLs.has(id)) { URL.revokeObjectURL(objectURLs.get(id)); objectURLs.delete(id); }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["files", "metadata"], "readwrite");
      tx.objectStore("files").delete(id);
      tx.objectStore("metadata").delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  function pickFiles(kind) {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = kind === "library" ? ".json,application/json" : "audio/*,.flac,.m4a,.opus,.ogg,.wav,.mp3";
      input.multiple = kind !== "library";
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve([]);
      input.click();
    });
  }
  async function importFiles(args) {
    const files = await pickFiles(args?.kind);
    if (!files.length) return [];
    if (args?.kind === "library") return JSON.parse(await files[0].text());
    const tracks = [];
    for (const file of files) {
      const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const title = file.name.replace(/\.[^.]+$/, "");
      const track = { id, title, artist: "本地音乐", album: "", artwork: "", duration: 0, source: "audio", url: `local:${id}` };
      await saveFile(id, file, { name: file.name, track });
      tracks.push(track);
    }
    return tracks;
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { saved: true };
  }
  async function downloadFile(args) {
    const controller = new AbortController();
    downloads.set(args.id, controller);
    try {
      const response = await fetch(args.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`下载失败：${response.status}`);
      const totalBytes = Number(response.headers.get("content-length")) || undefined;
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value); bytes += part.value.byteLength;
        shell.hostEvent("files.download.progress", { id: args.id, bytes, totalBytes, progress: totalBytes ? bytes / totalBytes : 0 });
      }
      const blob = new Blob(chunks, { type: response.headers.get("content-type") || "audio/mp4" });
      await saveFile(args.id, blob, { name: args.name, track: args.track });
      return { destination: args.name, url: `local:${args.id}`, bytes };
    } finally { downloads.delete(args.id); }
  }
  function setMetadata(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = track ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album || "Metrolist", artwork: track.artwork ? [{ src: track.artwork, sizes: "600x600" }] : [] }) : null;
  }
  function startBrowser() {
    addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; });
    if ("mediaSession" in navigator) {
      for (const [name, action] of [["play", "play"], ["pause", "pause"], ["previoustrack", "previous"], ["nexttrack", "next"]]) {
        navigator.mediaSession.setActionHandler(name, () => shell.hostEvent("media.command", { action }));
      }
      navigator.mediaSession.setActionHandler("seekto", event => shell.hostEvent("media.command", { action: "seek", value: event.seekTime }));
    }
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }
  const commands = {
    "files.import": importFiles,
    "files.resolve": args => resolveFile(args.id),
    "files.export": args => saveBlob(new Blob([args.content], { type: args.type || "application/json" }), args.name),
    "files.download": downloadFile,
    "files.cancelDownload": args => downloads.get(args.id)?.abort(),
    "files.removeDownload": args => removeFile(args.id),
    async "files.exportAudio"(args) {
      const file = await readFile(args.id);
      if (!file) throw new Error("音频文件已被移除");
      return saveBlob(file, args.name);
    },
    "app.metadata": setMetadata,
    "app.playback"(state) {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
      if (Number.isFinite(state.duration) && state.duration > 0) navigator.mediaSession.setPositionState({ duration: state.duration, playbackRate: state.rate || 1, position: Math.max(0, Math.min(state.duration, state.position || 0)) });
      else navigator.mediaSession.setPositionState();
    },
    "app.start": startBrowser,
    "app.url": () => ({ origin: location.origin }),
    async "app.install"() {
      if (!installPrompt) return { available: false };
      await installPrompt.prompt();
      return { available: true, ...(await installPrompt.userChoice) };
    },
  };
  return { call(name, args) { return commands[name](args); } };
}
