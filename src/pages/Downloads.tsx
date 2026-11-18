import { View, Scroll, signal, computed, platform } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { createSelection, downloadTracks } from "../components/SongSelection";
import { artistStorage, missingDownloads, orderDownloads, qualityLabels, sortLabels } from "../downloadCollection";
import { Icon } from "../icons";
import type { AudioQuality, DownloadJob, DownloadSort, Track } from "../model";
import { Label, Pill, Chip, Tool, Field, Art, Empty, Modal, CommandMenu, Press, palette as c, narrow, bytes, action, say } from "../ui";

const downloadLabels = { queued: "等待中", resolving: "正在解析音频", downloading: "正在下载", completed: "已下载", failed: "下载失败", cancelled: "已取消" };
const activeDownload = (job: DownloadJob) => job.status === "queued" || job.status === "resolving" || job.status === "downloading";
const retryableDownload = (job: DownloadJob) => job.status === "failed" || job.status === "cancelled";
const downloadedTrack = (job: DownloadJob): Track => ({ ...job.track, source: "audio", url: job.url });

export function DownloadsPage() {
  const filter = signal("all");
  const query = signal("");
  const playlistId = signal("");
  const exclude = signal(false);
  const quality = signal<AudioQuality | "all">("all");
  const artist = signal<string | null>(null);
  const panel = signal<"filters" | "storage" | null>(null);
  const playlistQuery = signal("");
  const changeQuality = signal<DownloadJob | null>(null);
  const playlist = computed(() => s.playlists().find(item => item.id === playlistId()));
  const memberIds = computed(() => playlist() && new Set(playlist()!.tracks.map(track => track.id)));
  const missing = computed(() => missingDownloads(playlist()?.tracks ?? [], s.downloadJobs()));
  const storageByArtist = computed(() => artistStorage(s.downloadJobs()));
  const sorting = () => s.settings().downloadSorting;
  const sortBy = (sort: DownloadSort, descending: boolean) => s.updateSettings({ downloadSorting: { sort, descending } });
  const ordered = computed(() => orderDownloads(s.downloadJobs(), sorting().sort, sorting().descending,
    sorting().sort === "plays" || sorting().sort === "lastPlayed" ? s.listenEvents() : []));
  const allCompleted = computed(() => ordered().filter(job => job.status === "completed").map(downloadedTrack));
  const matching = computed(() => {
    const term = query().trim().toLowerCase();
    const members = memberIds();
    return ordered().filter(job =>
      (!members || members.has(job.id) !== exclude()) &&
      (quality() === "all" || job.quality === quality()) &&
      (artist() === null || job.track.artist === artist()) &&
      `${job.track.title} ${job.track.artist} ${job.track.album} ${job.name}`.toLowerCase().includes(term));
  });
  const matchesFilter = (job: DownloadJob, value: string) => value === "all" || value === "active" && activeDownload(job) || value === job.status;
  const jobs = computed(() => matching().filter(job => matchesFilter(job, filter())));
  const completeJobs = computed(() => jobs().filter(job => job.status === "completed"));
  const completed = computed(() => completeJobs().map(downloadedTrack));
  const hasCriteria = () => !!query().trim() || !!playlist() || quality() !== "all" || artist() !== null;
  const filtered = () => hasCriteria() || filter() !== "all";
  const reset = () => { query.set(""); playlistId.set(""); exclude.set(false); quality.set("all"); artist.set(null); filter.set("all"); };
  const selection = createSelection(() => completeJobs().map(job => job.id));
  const selectedJobs = computed(() => {
    const ids = new Set(selection.keys());
    return s.downloadJobs().filter(job => job.status === "completed" && ids.has(job.id));
  });
  const removeSelected = () => action(async () => {
    const rows = selectedJobs();
    selection.finish();
    for (const row of rows) await s.removeDownload(row.id);
  }, "已移除所选下载");
  const active = computed(() => s.downloadJobs().filter(activeDownload));
  const activeBytes = computed(() => active().reduce((sum, job) => sum + job.bytes, 0));
  const activeTotal = computed(() => active().every(job => !!job.totalBytes) ? active().reduce((sum, job) => sum + job.totalBytes!, 0) : 0);
  const totalBytes = computed(() => s.downloadJobs().filter(job => job.status === "completed").reduce((sum, job) => sum + job.bytes, 0));
  const retryable = computed(() => jobs().filter(retryableDownload));
  const cancellable = computed(() => jobs().filter(activeDownload));
  const tabs = [{ id: "all", label: "全部" }, { id: "active", label: "下载中" }, { id: "completed", label: "已完成" }, { id: "failed", label: "失败" }, { id: "cancelled", label: "已取消" }];
  const retryVisible = () => { for (const job of retryable()) void action(() => s.retryDownload(job.id)); };
  const cancelVisible = () => action(() => Promise.all(cancellable().map(job => s.cancelDownload(job.id))), "已取消当前列表中的下载");
  const clearVisible = () => action(() => Promise.all(retryable().map(job => s.removeDownload(job.id))), "已清除失败和取消的记录");
  return <View testID="page-downloads" style={{ gap: 24 }}>
    <View style={{ backgroundColor: c().selected, padding: narrow() ? 20 : 24, borderRadius: 24, gap: 20 }}>
      <View style={{ flexDirection: narrow() ? "column" : "row", gap: 20, alignItems: narrow() ? "stretch" : "center" }}>
        <View style={{ flexDirection: "row", flex: narrow() ? undefined : 1, minWidth: 0, gap: 16, alignItems: "center" }}><Icon name="storage" size={32} color={c().accent} /><View style={{ gap: 5, flex: 1, minWidth: 0 }}><Label size={12} color={c().sub}>已下载音频</Label><Label testID="download-storage" size={30} weight="600">{bytes(totalBytes())}</Label><Label size={13} color={c().sub}>{s.downloads().length} 首歌曲 · 随时继续聆听</Label></View></View>
        <Tool testID="download-space" icon="storage" label="按歌手查看占用空间" onPress={() => panel.set("storage")} />
        <Pill testID="download-play-all" label="播放已下载歌曲" icon="play" primary disabled={p.remoteControlled() || !s.downloads().length} onPress={() => action(() => p.playList(allCompleted(), 0, "已下载"))} />
      </View>
      <If when={active().length > 0}><View testID="download-active-summary" style={{ gap: 10, paddingTop: 16, borderTopWidth: 1, borderColor: c().line }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}><Label size={13}>{active().length} 首正在下载</Label><Label size={12} color={c().sub}>{bytes(activeBytes())}{activeTotal() ? ` / ${bytes(activeTotal())}` : " · 正在传输"}</Label></View>
        <If when={activeTotal() > 0}><View style={{ height: 5, borderRadius: 5, backgroundColor: c().raised, overflow: "hidden" }}><View style={{ height: "100%", width: `${Math.round(activeBytes() / activeTotal() * 100)}%` as `${number}%`, backgroundColor: c().accent, borderRadius: 5 }} /></View></If>
      </View></If>
    </View>
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Field testID="download-search" value={query()} onChange={query.set} placeholder="搜索歌曲、歌手或专辑" />
        <If when={query()}><Tool testID="download-clear-search" label="清空下载搜索" icon="close" onPress={() => query.set("")} /></If>
        <CommandMenu testID="download-batch" label="批量下载操作" icon="more" items={[
          { testID: "download-retry-visible", label: `重试 ${retryable().length} 个任务`, icon: "refresh", disabled: !retryable().length, run: retryVisible },
          { testID: "download-cancel-visible", label: `取消 ${cancellable().length} 个下载`, icon: "close", disabled: !cancellable().length, run: () => void cancelVisible() },
          { testID: "download-clear-visible", label: `清除 ${retryable().length} 条失败或取消记录`, icon: "trash", disabled: !retryable().length, run: () => void clearVisible() },
        ]} />
      </View>
      <View class="flex-row flex-wrap items-center gap-2">
        <Pill testID="download-filters" label="筛选下载" icon="list" onPress={() => { playlistQuery.set(""); panel.set("filters"); }} />
        <CommandMenu testID="download-sort" label="下载排序" icon="sort" items={[
          ...Object.entries(sortLabels).map(([key, label]) => ({ testID: `download-sort-${key}`, label, active: sorting().sort === key,
            run: () => sortBy(key as DownloadSort, key !== "title" && key !== "artist") })),
          { testID: "download-sort-direction", label: sorting().descending ? "切换为升序" : "切换为降序", separator: true, run: () => sortBy(sorting().sort, !sorting().descending) },
        ]} />
        <Label size={12} color={c().sub}>{sortLabels[sorting().sort]}{sorting().descending ? " ↓" : " ↑"}</Label>
        <If when={playlist()}><Chip label={`${exclude() ? "排除" : "包含"} · ${playlist()?.name}`} selected onPress={() => playlistId.set("")} /></If>
        <If when={quality() !== "all"}><Chip label={qualityLabels[quality() as AudioQuality]} selected onPress={() => quality.set("all")} /></If>
        <If when={artist() !== null}><Chip label={artist() || "未知歌手"} selected onPress={() => artist.set(null)} /></If>
      </View>
      <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={tabs}>{item => <Chip testID={`download-filter-${item().id}`} label={`${item().label} ${matching().filter(job => matchesFilter(job, item().id)).length}`} selected={filter() === item().id} onPress={() => filter.set(item().id)} />}</Each></Scroll>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}><Label testID="download-result-count" size={12} color={c().sub} style={{ flex: 1 }}>当前列表 {jobs().length} 首</Label><If when={completed().length > 0 && filtered()}><Pill testID="download-play-visible" label={`播放这 ${completed().length} 首`} icon="play" disabled={p.remoteControlled()} onPress={() => action(() => p.playList(completed(), 0, query().trim() ? `下载 · ${query().trim()}` : "已下载"))} /></If></View>
      <View class="flex-row flex-wrap items-center gap-2">
        <CommandMenu testID="download-music-actions" label="离线歌曲操作" icon="queue" items={[
          { testID: "download-shuffle", label: "随机播放当前结果", icon: "shuffle", disabled: !completed().length || p.remoteControlled(), run: () => void action(() => p.playList(p.shuffled(completed()), 0, "已下载")) },
          { testID: "download-next", label: "下一首播放当前结果", icon: "next", disabled: !completed().length || p.remoteControlled(), run: () => { p.playNextTracks(completed()); say("已放到下一首"); } },
          { testID: "download-append", label: "追加当前结果到队尾", icon: "queue", disabled: !completed().length || p.remoteControlled(), run: () => { p.addTracksToQueue(completed()); say("已加入队列"); } },
          { testID: "download-save-playlist", label: "当前结果加入歌单", icon: "plus", disabled: !completed().length, run: () => nav.addToPlaylist(completeJobs().map(job => job.track)) },
        ]} />
        <Pill testID="download-select" label={selection.active() ? "完成选择" : "选择文件"} icon="checkCircle" onPress={() => selection.active() ? selection.finish() : selection.begin()} />
        <If when={playlist() && !exclude()}><Pill testID="download-fill" label={`补齐整张歌单 · ${missing().length} 首`} icon="download" disabled={!missing().length} onPress={() => downloadTracks(missing())} /></If>
      </View>
      <If when={selection.active()}><View class="flex-row flex-wrap items-center gap-2">
        <Label testID="download-selection-total">已选 {selectedJobs().length} 首 · {bytes(selectedJobs().reduce((sum, job) => sum + job.bytes, 0))}</Label>
        <Pill testID="download-select-all" label="全选当前文件" onPress={selection.all} />
        <Pill testID="download-select-clear" label="取消全选" onPress={selection.clear} />
        <Pill testID="download-remove-selected" label="移除所选下载" icon="trash" disabled={!selectedJobs().length} onPress={() => void removeSelected()} />
      </View></If>
    </View>
    <If when={jobs().length > 0} else={<Empty icon={query() ? "search" : "download"} title={hasCriteria() ? "没有匹配的下载" : filter() === "all" ? "没有下载任务" : "当前分类暂无任务"} description={hasCriteria() ? "可调整筛选条件，或查看全部下载。" : platform.os === "ios" ? "从歌曲、专辑或歌单菜单选择下载，完成后可以离线播放。" : "从歌曲、专辑或歌单菜单选择下载，完成后可以播放或另存音频。"}><If when={filtered()} else={<Pill label="打开音乐库" onPress={() => nav.navigate("library", true)} />}><Pill testID="download-show-all" label="查看全部下载" onPress={reset} /></If></Empty>}><View style={{ gap: 12 }}><Each of={jobs()}>{job => <View testID={`download-${job().id}`} style={{ padding: 16, gap: 14, borderRadius: 18, backgroundColor: c().card }}>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}><If when={selection.active() && job().status === "completed"}><Tool testID={`download-select-${job().id}`} label={`选择 ${job().track.title}`} icon="checkCircle" active={selection.keys().includes(job().id)} onPress={() => selection.toggle(job().id)} /></If><Art track={job().track} size={56} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600" lines={2}>{job().track.title}</Label><Label color={c().sub} size={12} lines={1}>{job().track.artist}</Label></View>
      <CommandMenu testID={`download-menu-${job().id}`} label="下载操作" items={[
        ...(job().status === "completed" && platform.os !== "ios" ? [{ testID: `download-export-${job().id}`, label: "保存音频到设备", icon: "download", run: () => void action(() => s.exportDownloaded(job().id)) }] : []),
        ...(job().status === "completed" && platform.desktop && job().destination && job().url?.startsWith("file:") ? [{ testID: `download-reveal-${job().id}`, label: "在文件夹中显示", icon: "storage", run: () => void action(() => s.revealDownload(job().id)) }] : []),
        ...(job().status === "completed" && job().track.source === "youtube" ? [{ testID: `download-quality-${job().id}`, label: "更换下载音质", icon: "download", run: () => changeQuality.set(job()) }] : []),
        { label: "移除下载", icon: "trash", danger: true, run: () => void action(() => s.removeDownload(job().id)) },
      ]} /></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Label size={12} style={{ flex: 1 }} color={job().status === "failed" ? c().danger : job().status === "completed" ? c().good : c().accent}>{downloadLabels[job().status]}{job().track.source === "youtube" ? ` · ${qualityLabels[job().quality]}` : ""}{job().status === "downloading" && job().totalBytes ? ` · ${Math.round(job().progress * 100)}%` : ""}{job().bytes ? ` · ${bytes(job().bytes)}${job().totalBytes && job().status !== "completed" ? ` / ${bytes(job().totalBytes!)}` : ""}` : ""}</Label>
        <If when={job().status === "completed"} else={<If when={job().status === "failed" || job().status === "cancelled"} else={<Tool testID={`download-cancel-${job().id}`} icon="close" label="取消下载" onPress={() => void action(() => s.cancelDownload(job().id))} />}><Tool testID={`download-retry-${job().id}`} icon="refresh" label="重试下载" onPress={() => void action(() => s.retryDownload(job().id))} /></If>}><Tool testID={`download-play-${job().id}`} disabled={p.remoteControlled()} icon="play" label="播放下载" onPress={() => action(() => p.playTrack(downloadedTrack(job()), completed()))} /></If>
      </View>
      <If when={["resolving", "queued", "downloading"].includes(job().status)}><View style={{ height: 5, borderRadius: 5, backgroundColor: c().raised, overflow: "hidden" }}><View style={{ height: "100%", width: `${Math.round(job().progress * 100)}%` as `${number}%`, backgroundColor: c().accent, borderRadius: 5 }} /></View></If>
      <If when={job().error}><Label size={12} color={c().danger} style={{ lineHeight: 19 }}>{job().error}</Label></If>
    </View>}</Each></View></If>
    <If when={panel() === "filters"}><Modal title="筛选下载" close={() => panel.set(null)}>
      <Label weight="600">下载音质</Label><View class="flex-row flex-wrap gap-2">
        <Each of={Object.entries({ all: "全部音质", ...qualityLabels })}>{item => <Chip testID={`download-quality-filter-${item()[0]}`} label={item()[1]} selected={quality() === item()[0]} onPress={() => quality.set(item()[0] as AudioQuality | "all")} />}</Each>
      </View>
      <Label weight="600">本机歌单</Label>
      <Field testID="download-find-playlist" value={playlistQuery()} onChange={playlistQuery.set} placeholder="查找歌单" />
      <View class="flex-row flex-wrap gap-2">
        <Chip label="不限歌单" selected={!playlist()} onPress={() => playlistId.set("")} />
        <Each of={s.playlists().filter(item => item.name.toLowerCase().includes(playlistQuery().trim().toLowerCase()))}>{item => <Chip testID={`download-scope-${item().id}`} label={item().name} selected={playlistId() === item().id} onPress={() => playlistId.set(item().id)} />}</Each>
      </View>
      <If when={playlist()}><View class="flex-row gap-2"><Chip label="包含歌单歌曲" selected={!exclude()} onPress={() => exclude.set(false)} /><Chip testID="download-exclude" label="排除歌单歌曲" selected={exclude()} onPress={() => exclude.set(true)} /></View></If>
      <Pill testID="download-apply-filters" label="查看结果" primary onPress={() => panel.set(null)} />
    </Modal></If>
    <If when={panel() === "storage"}><Modal title="按歌手查看占用空间" close={() => panel.set(null)}>
      <If when={!storageByArtist().length}><Label>尚无已下载文件</Label></If>
      <Each of={storageByArtist()}>{row => <Press label={row().artist || "未知歌手"} onPress={() => {
        reset(); artist.set(row().artist); filter.set("completed"); panel.set(null);
      }} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Label style={{ flex: 1 }}>{row().artist || "未知歌手"}</Label><Label>{row().count} 首 · {bytes(row().bytes)}</Label>
      </Press>}</Each>
    </Modal></If>
    <If when={changeQuality()}><Modal title="更换下载音质" close={() => changeQuality.set(null)}>
      <Label>{changeQuality()?.track.title}</Label>
      <Each of={Object.entries(qualityLabels)}>{item => <Pill testID={`download-replace-${item()[0]}`} label={item()[1]} disabled={changeQuality()?.quality === item()[0]} onPress={() => {
        const track = changeQuality()!.track;
        changeQuality.set(null);
        const quality = item()[0] as AudioQuality;
        void action(async () => { if (await s.downloadTrack(track, quality)) say("已更换下载音质"); });
      }} />}</Each>
    </Modal></If>
  </View>;
}
