import { View, Scroll, computed, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { CatalogShelf } from "../components/Discovery";
import { TrackRow, ItemRail } from "../components/Music";
import { Icon } from "../icons";
import { Label, Tool, Pill, Chip, SectionTitle, Empty, Press, palette as c, narrow, pageGutter, action } from "../ui";

function HomeShortcuts() {
  return <View testID="home-shortcuts" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    <Each of={[
      { page: "liked", label: "喜欢的音乐", icon: "heart", detail: "喜欢过的歌曲" },
      { page: "downloads", label: "已下载", icon: "download", detail: `${s.downloads().length} 首离线音乐` },
      { page: "history", label: "最近播放", icon: "clock", detail: `${s.history().length} 首听过的歌` },
      { page: "together", label: "一起听", icon: "users", detail: together.room() ? `房间 ${together.room()!.roomCode}` : "与朋友同步聆听" },
    ] as const}>{item => <Press testID={`home-${item().page}`} label={item().label} onPress={() => nav.navigate(item().page)} style={{ flexGrow: 1, flexBasis: "46%", minWidth: 0, minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, backgroundColor: c().card }}>
      <Icon name={item().icon} size={22} color={item().page === "liked" ? c().danger : c().accent} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Label size={13} weight="600" lines={1}>{item().label}</Label><Label size={10} color={c().sub} lines={1}>{item().detail}</Label></View>
    </Press>}</Each>
  </View>;
}

export function HomePage() {
  const picks = computed(() => [...new Map([...s.likedTracks(), ...s.libraryTracks()].map(track => [track.id, track])).values()].slice(0, 16));
  const columns = computed(() => Array.from({ length: Math.ceil(picks().length / 4) }, (_, index) => picks().slice(index * 4, index * 4 + 4)));
  const hasContent = () => s.home().sections.some(section => section.items.length || section.moods?.length);
  return <View testID="page-home" style={{ gap: 28 }}>
    <If when={s.home().chips?.length}><Scroll testID="home-chips" horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
      <If when={s.selectedHomeChip()}><Tool testID="home-filter-clear" label="清除分类" icon="close" onPress={s.clearHomeFilter} /></If>
      <Each of={s.home().chips || []}>{(chip, index) => <Chip testID={`home-chip-${index()}`} label={chip().title} selected={s.selectedHomeChip()?.title === chip().title} onPress={() => void s.selectHomeChip(chip())} />}</Each>
    </Scroll></If>
    <If when={s.homeLoading() && !hasContent()}><View testID="home-loading" style={{ paddingVertical: 16, gap: 18 }}>
      <Label color={c().accent}>{s.selectedHomeChip() ? `正在加载${s.selectedHomeChip()!.title}…` : "正在加载推荐…"}</Label>
      <View style={{ height: 24, width: "48%", borderRadius: 8, backgroundColor: c().card }} />
      <View style={{ flexDirection: "row", gap: 16 }}><View style={{ height: 180, flex: 1, borderRadius: 16, backgroundColor: c().card }} /><View style={{ height: 180, flex: 1, borderRadius: 16, backgroundColor: c().card }} /></View>
    </View></If>
    <If when={!s.homeLoading() && !hasContent()}><View testID="home-empty"><Empty icon="compass" title={s.selectedHomeChip() ? `暂时没有${s.selectedHomeChip()!.title}推荐` : "暂时没有首页推荐"} description="可以刷新推荐，或从探索中发现音乐。"><If when={s.selectedHomeChip()}><Pill testID="home-empty-clear" label="查看全部推荐" icon="close" onPress={s.clearHomeFilter} /></If></Empty></View></If>
    <Each of={s.home().sections}>{(section, index) => <CatalogShelf section={section()} testID={`home-section-${index()}`} />}</Each>
    <If when={s.home().continuation}><View style={{ alignItems: "center" }}><Pill testID="home-more" label={s.homeLoading() ? "正在加载…" : "加载更多推荐"} disabled={s.homeLoading()} onPress={() => void s.loadMoreHome()} /></View></If>
    <If when={!s.selectedHomeChip()}>
      <If when={s.history().length > 0}><View><SectionTitle title="继续聆听" action="全部" onPress={() => nav.navigate("history")} /><ItemRail items={s.history().slice(0, 12)} /></View></If>
      <If when={picks().length > 0}><View testID="home-local-picks"><SectionTitle title="快速选歌" subtitle="从喜欢的歌曲和音乐库中继续" disabled={p.remoteControlled()} action="播放全部" icon="play" onPress={() => action(() => p.playList(picks(), 0, "快速选歌"))} />
        <Scroll horizontal scrollbar={false} style={{ height: Math.min(4, picks().length) * 68 + 4 }} contentStyle={{ flexDirection: "row", gap: 16 }}><Each of={columns()}>{column => <View style={{ width: narrow() ? Math.min(350, windowSize().width - pageGutter() * 2) : 350 }}><Each of={column()}>{track => <TrackRow track={track()} list={picks()} compact />}</Each></View>}</Each></Scroll>
      </View></If>
      <If when={narrow()}><HomeShortcuts /></If>
      <View style={{ gap: 12 }}><SectionTitle title="探索" /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Each of={[{ tab: "new", title: "新歌与新专辑", icon: "spark" }, { tab: "charts", title: "排行榜", icon: "stats" }, { tab: "moods", title: "心情与流派", icon: "compass" }] as const}>{item => <Press label={item().title} testID={`discover-${item().tab}`} onPress={() => nav.openExplore(item().tab, item().title)} style={{ flex: 1, minWidth: narrow() ? "100%" : 220, minHeight: 72, padding: 18, borderRadius: 20, backgroundColor: c().card, flexDirection: "row", gap: 16, alignItems: "center" }}><Icon name={item().icon} size={26} color={c().accent} /><Label size={14} weight="600" style={{ flex: 1 }}>{item().title}</Label><Icon name="right" size={18} color={c().sub} /></Press>}</Each>
      </View></View>
    </If>
    <View style={{ alignItems: "center" }}><Pill testID="home-refresh" label={s.homeLoading() ? "正在刷新…" : "刷新推荐"} icon="refresh" disabled={s.homeLoading()} onPress={() => void s.loadHome()} /></View>
  </View>;
}
