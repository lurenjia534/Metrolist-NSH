import { View, Scroll, signal, computed, platform } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { TrackRow } from "../components/Music";
import { Icon } from "../icons";
import type { DownloadJob, Track } from "../model";
import { Label, Pill, Chip, Tool, Field, Art, Empty, Section, SectionTitle, CommandMenu, Press, palette as c, narrow, bytes, action } from "../ui";

const downloadLabels = { queued: "等待中", resolving: "正在解析音频", downloading: "正在下载", completed: "已下载", failed: "下载失败", cancelled: "已取消" };
const activeDownload = (job: DownloadJob) => job.status === "queued" || job.status === "resolving" || job.status === "downloading";
const retryableDownload = (job: DownloadJob) => job.status === "failed" || job.status === "cancelled";
const downloadedTrack = (job: DownloadJob): Track => ({ ...job.track, source: "audio", url: job.url });

export function DownloadsPage() {
  const filter = signal("all");
  const query = signal("");
  const matching = computed(() => {
    const term = query().trim().toLowerCase();
    return s.downloadJobs().filter(job => `${job.track.title} ${job.track.artist} ${job.track.album} ${job.name}`.toLowerCase().includes(term));
  });
  const matchesFilter = (job: DownloadJob, value: string) => value === "all" || value === "active" && activeDownload(job) || value === job.status;
  const jobs = computed(() => matching().filter(job => matchesFilter(job, filter())));
  const completed = computed(() => jobs().filter(job => job.status === "completed").map(downloadedTrack));
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
        <Pill testID="download-play-all" label="播放已下载歌曲" icon="play" primary disabled={p.remoteControlled() || !s.downloads().length} onPress={() => action(() => p.playList(s.downloads(), 0, "已下载"))} />
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
      <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={tabs}>{item => <Chip testID={`download-filter-${item().id}`} label={`${item().label} ${matching().filter(job => matchesFilter(job, item().id)).length}`} selected={filter() === item().id} onPress={() => filter.set(item().id)} />}</Each></Scroll>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}><Label testID="download-result-count" size={12} color={c().sub} style={{ flex: 1 }}>当前列表 {jobs().length} 首 · 批量操作仅应用于当前列表</Label><If when={completed().length > 0 && (query().trim() || filter() === "completed")}><Pill testID="download-play-visible" label={`播放这 ${completed().length} 首`} icon="play" disabled={p.remoteControlled()} onPress={() => action(() => p.playList(completed(), 0, query().trim() ? `下载 · ${query().trim()}` : "已下载"))} /></If></View>
    </View>
    <If when={jobs().length > 0} else={<Empty icon={query() ? "search" : "download"} title={query() ? "没有匹配的下载" : filter() === "all" ? "没有下载任务" : "当前分类暂无任务"} description={query() ? "试试其他歌曲、歌手或专辑名称。" : platform.os === "ios" ? "从歌曲、专辑或歌单菜单选择下载，完成后可以离线播放。" : "从歌曲、专辑或歌单菜单选择下载，完成后可以播放或另存音频。"}><If when={query() || filter() !== "all"} else={<Pill label="打开音乐库" onPress={() => nav.navigate("library", true)} />}><Pill testID="download-show-all" label="查看全部下载" onPress={() => { query.set(""); filter.set("all"); }} /></If></Empty>}><View style={{ gap: 12 }}><Each of={jobs()}>{job => <View testID={`download-${job().id}`} style={{ padding: 16, gap: 14, borderRadius: 18, backgroundColor: c().card }}>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}><Art track={job().track} size={56} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600" lines={2}>{job().track.title}</Label><Label color={c().sub} size={12} lines={1}>{job().track.artist}</Label></View>
      <CommandMenu testID={`download-menu-${job().id}`} label="下载操作" items={[
        ...(job().status === "completed" && platform.os !== "ios" ? [{ testID: `download-export-${job().id}`, label: "保存音频到设备", icon: "download", run: () => void action(() => s.exportDownloaded(job().id)) }] : []),
        ...(job().status === "completed" && platform.desktop && job().destination && job().url?.startsWith("file:") ? [{ testID: `download-reveal-${job().id}`, label: "在文件夹中显示", icon: "storage", run: () => void action(() => s.revealDownload(job().id)) }] : []),
        { label: "移除下载", icon: "trash", danger: true, run: () => void action(() => s.removeDownload(job().id)) },
      ]} /></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Label size={12} style={{ flex: 1 }} color={job().status === "failed" ? c().danger : job().status === "completed" ? c().good : c().accent}>{downloadLabels[job().status]}{job().status === "downloading" && job().totalBytes ? ` · ${Math.round(job().progress * 100)}%` : ""}{job().bytes ? ` · ${bytes(job().bytes)}${job().totalBytes && job().status !== "completed" ? ` / ${bytes(job().totalBytes!)}` : ""}` : ""}</Label>
        <If when={job().status === "completed"} else={<If when={job().status === "failed" || job().status === "cancelled"} else={<Tool testID={`download-cancel-${job().id}`} icon="close" label="取消下载" onPress={() => void action(() => s.cancelDownload(job().id))} />}><Tool testID={`download-retry-${job().id}`} icon="refresh" label="重试下载" onPress={() => void action(() => s.retryDownload(job().id))} /></If>}><Tool testID={`download-play-${job().id}`} disabled={p.remoteControlled()} icon="play" label="播放下载" onPress={() => action(() => p.playTrack(downloadedTrack(job()), completed()))} /></If>
      </View>
      <If when={["resolving", "queued", "downloading"].includes(job().status)}><View style={{ height: 5, borderRadius: 5, backgroundColor: c().raised, overflow: "hidden" }}><View style={{ height: "100%", width: `${Math.round(job().progress * 100)}%` as `${number}%`, backgroundColor: c().accent, borderRadius: 5 }} /></View></If>
      <If when={job().error}><Label size={12} color={c().danger} style={{ lineHeight: 19 }}>{job().error}</Label></If>
    </View>}</Each></View></If>
  </View>;
}

export function StatisticsPage() {
  const stats = s.statistics;
  const daily = computed(() => stats().daily.slice(-31));
  const max = computed(() => Math.max(1, ...daily().map(day => day.seconds)));
  const selectedDay = signal("");
  return <View testID="page-stats" style={{ gap: 28 }}>
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Each of={[{ id: "week", label: "近 7 天" }, { id: "month", label: "近 30 天" }, { id: "year", label: "近一年" }, { id: "all", label: "全部时间" }] as const}>{period => <Chip label={period().label} selected={s.statsPeriod() === period().id} onPress={() => s.statsPeriod.set(period().id)} />}</Each></View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={[{ value: `${Math.floor(stats().totalSeconds / 60)}`, unit: "聆听分钟", icon: "headphones" }, { value: `${stats().plays}`, unit: "播放次数", icon: "play" }, { value: `${stats().uniqueTracks}`, unit: "首不同歌曲", icon: "music" }]}>{item => <View style={{ flex: 1, minWidth: 96, backgroundColor: c().card, borderRadius: 22, padding: narrow() ? 16 : 24, gap: 14 }}><Icon name={item().icon} size={24} color={c().accent} /><Label size={narrow() ? 28 : 36} weight="600">{item().value}</Label><Label size={12} color={c().sub}>{item().unit}</Label></View>}</Each></View>
    <If when={stats().plays > 0} else={<Empty icon="stats" title="从下一首开始记录" description="累计听满 30 秒的播放会计入统计。这里只记录实际聆听的时间。" />}>
      <Section title="每日聆听"><View style={{ height: 160, flexDirection: "row", alignItems: "flex-end", gap: narrow() ? 4 : 8 }}><Each of={daily()}>{day => <Press label={`${day().date}，${Math.floor(day().seconds / 60)} 分钟`} onPress={() => selectedDay.set(`${day().date} · ${Math.floor(day().seconds / 60)} 分钟 · ${day().plays} 次播放`)} style={{ flex: 1, minWidth: 0, height: Math.max(4, day().seconds / max() * 150), backgroundColor: c().accent, borderRadius: 5 }} />}</Each></View><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label size={11} color={c().sub}>{daily()[0]?.date}</Label><Label size={11} color={c().sub}>{daily().at(-1)?.date}</Label></View><If when={selectedDay()}><Label size={13} color={c().accent}>{selectedDay()}</Label></If></Section>
      <View><SectionTitle title="最常听的歌曲" /><Each of={stats().topTracks.slice(0, 20)}>{(item, index) => <View><TrackRow track={item().track} rank={index() + 1} list={stats().topTracks.map(row => row.track)} /><Label size={12} color={c().faint} style={{ marginLeft: 100, marginTop: -4, marginBottom: 12 }}>{item().playCount} 次 · {Math.floor(item().seconds / 60)} 分钟</Label></View>}</Each></View>
      <View><SectionTitle title="最常听的歌手" /><Each of={stats().topArtists.slice(0, 12)}>{(artist, index) => <Press label={artist().name} onPress={() => artist().id.startsWith("UC") ? nav.browse({ id: artist().id, browseId: artist().id, title: artist().name, subtitle: "", artwork: artist().artwork, type: "artist" }) : nav.performSearch(artist().name, "artists")} style={{ minHeight: 84, flexDirection: "row", alignItems: "center", gap: 16, padding: 8 }}><Label size={14} color={c().sub} style={{ width: 20 }}>{index() + 1}</Label><Art src={artist().artwork} icon="artist" size={56} radius={40} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}><Label weight="600">{artist().name}</Label><Label size={12} color={c().sub}>{artist().playCount} 次 · {Math.floor(artist().seconds / 60)} 分钟</Label></View><Icon name="right" size={20} color={c().sub} /></Press>}</Each></View>
    </If>
  </View>;
}
