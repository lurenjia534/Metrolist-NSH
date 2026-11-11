import { View, Scroll, computed, signal, cleanup, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { isTrack, type Collection, type SearchType, type ExploreTab } from "../model";
import { Icon } from "../icons";
import { TrackRow, TrackList, MusicCard, ItemRail, CollectionRow } from "../components/Music";
import { Label, Tool, Pill, Chip, Field, SectionTitle, Empty, Press, palette as c, narrow, pageGutter, action } from "../ui";

export function HomePage() {
  const picks = computed(() => {
    const online = s.home().sections.flatMap(section => section.items.filter(isTrack));
    return [...new Map([...s.history().slice(0, 4), ...online, ...s.tracks()].map(track => [track.id, track])).values()].slice(0, 16);
  });
  const columns = computed(() => Array.from({ length: Math.ceil(picks().length / 4) }, (_, index) => picks().slice(index * 4, index * 4 + 4)));
  const discover = (tab: ExploreTab, title: string) => { nav.browseTitle.set(title); nav.navigate("browse"); void s.loadExplore(tab); };
  return <View testID="page-home" style={{ gap: 28 }}>
    <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
      <Each of={[{ label: "放松", q: "relax chill music" }, { label: "通勤", q: "commute music" }, { label: "专注", q: "focus music" }, { label: "运动", q: "workout music" }, { label: "睡眠", q: "sleep music" }, { label: "心情不错", q: "feel good music" }]}>{item => <Chip label={item().label} selected={false} onPress={() => nav.performSearch(item().q)} />}</Each>
    </Scroll>
    <View><SectionTitle title="快速选歌" disabled={p.remoteControlled()} action="播放全部" icon="play" onPress={() => action(() => p.playList(picks(), 0, "快速选歌"))} />
      <Scroll horizontal scrollbar={false} style={{ height: 280 }} contentStyle={{ flexDirection: "row", gap: 16 }}><Each of={columns()}>{column => <View style={{ width: narrow() ? Math.min(350, windowSize().width - pageGutter() * 2) : 350, gap: 1 }}><Each of={column()}>{track => <TrackRow track={track()} list={picks()} compact />}</Each></View>}</Each></Scroll>
    </View>
    <If when={s.history().length > 0}><View><SectionTitle title="继续聆听" action="全部" onPress={() => nav.navigate("history")} /><ItemRail items={s.history().slice(0, 12)} /></View></If>
    <View style={{ gap: 12 }}><SectionTitle title="探索" /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <Each of={[{ tab: "new", title: "新歌与新专辑", icon: "spark" }, { tab: "charts", title: "排行榜", icon: "stats" }, { tab: "moods", title: "心情与流派", icon: "compass" }] as const}>{item => <Press label={item().title} testID={`discover-${item().tab}`} onPress={() => discover(item().tab, item().title)} style={{ flex: 1, minWidth: narrow() ? "100%" : 220, minHeight: 82, padding: 18, borderRadius: 20, backgroundColor: c().card, flexDirection: "row", gap: 16, alignItems: "center" }}><Icon name={item().icon} size={26} color={c().accent} /><Label size={14} weight="600" style={{ flex: 1 }}>{item().title}</Label><Icon name="right" size={18} color={c().sub} /></Press>}</Each>
    </View></View>
    <Each of={s.home().sections}>{section => <If when={section().items.length > 0}><View><SectionTitle title={section().title} /><ItemRail items={section().items} /></View></If>}</Each>
    <View style={{ flexDirection: "row", justifyContent: "center" }}><Pill label={s.homeLoading() ? "正在刷新…" : "刷新推荐"} icon="refresh" disabled={s.homeLoading()} onPress={() => void s.loadHome()} /></View>
  </View>;
}

export function ExplorePage() {
  return <View testID="page-browse" style={{ gap: 24 }}>
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Each of={[{ tab: "all", label: "全部" }, { tab: "new", label: "新发行" }, { tab: "charts", label: "排行榜" }, { tab: "moods", label: "心情与流派" }] as const}>{item => <Chip label={item().label} selected={s.exploreTab() === item().tab} onPress={() => void s.loadExplore(item().tab)} />}</Each></View>
    <If when={s.exploreLoading()}><Label color={c().accent}>正在加载…</Label></If>
    <If when={s.explore().moods.length > 0}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={s.explore().moods}>{mood => <Press label={mood().title} onPress={() => nav.browse({ id: `${mood().browseId}:${mood().params || ""}`, browseId: mood().browseId, params: mood().params, title: mood().title, subtitle: "心情与流派", artwork: "", type: "playlist" })} style={{ width: narrow() ? "47%" : "30%", minHeight: 76, borderRadius: 16, backgroundColor: c().card, borderLeftWidth: 5, borderLeftColor: mood().color || c().accent, padding: 18, justifyContent: "center" }}><Label size={15} weight="600">{mood().title}</Label></Press>}</Each></View></If>
    <Each of={s.explore().sections}>{section => <View><SectionTitle title={section().title} /><ItemRail items={section().items} all /></View>}</Each>
    <If when={s.explore().continuation}><Pill label="加载更多" disabled={s.exploreLoading()} onPress={() => void s.loadMoreExplore()} /></If>
    <If when={!s.exploreLoading() && !s.explore().sections.length && !s.explore().moods.length}><Empty icon="compass" title="还没有发现内容" description="刷新获取当前地区的音乐推荐。"><Pill label="刷新" onPress={() => void s.loadExplore()} /></Empty></If>
  </View>;
}

export function SearchPage() {
  let timer: ReturnType<typeof setTimeout>;
  cleanup(() => clearTimeout(timer));
  const suggesting = () => nav.searchText().trim() !== s.query() || !s.query();
  const change = (value: string) => { nav.searchText.set(value); clearTimeout(timer); timer = setTimeout(() => void s.loadSuggestions(value), 180); };
  const songs = computed(() => s.searchResults().filter(isTrack));
  const collections = computed(() => s.searchResults().filter(item => !isTrack(item)) as Collection[]);
  const run = (value = nav.searchText()) => nav.performSearch(value);
  return <View testID="page-search" style={{ gap: 24 }}>
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Field testID="search-input" value={nav.searchText()} onChange={change} placeholder="搜索歌曲、歌手、专辑、歌单" onSubmit={() => run()} /><Tool icon="search" label="搜索" testID="search-submit" onPress={() => run()} /><If when={nav.searchText()}><Tool icon="close" label="清空输入" onPress={() => change("")} /></If></View>
    <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={[{ type: "all", label: "全部" }, { type: "songs", label: "歌曲" }, { type: "albums", label: "专辑" }, { type: "artists", label: "歌手" }, { type: "playlists", label: "歌单" }] as const}>{item => <Chip label={item().label} selected={nav.searchType() === item().type} onPress={() => { nav.searchType.set(item().type as SearchType); if (nav.searchText().trim()) run(); }} />}</Each></Scroll>
    <If when={suggesting() && s.searchSuggestions().length > 0}><View style={{ gap: 4 }}><Each of={s.searchSuggestions()}>{value => <Press label={`搜索 ${value()}`} onPress={() => run(value())} style={{ minHeight: 52, alignItems: "center", flexDirection: "row", gap: 16, paddingHorizontal: 12 }}><Icon name="search" size={20} color={c().sub} /><Label style={{ flex: 1 }}>{value()}</Label><Icon name="arrow" size={18} color={c().faint} /></Press>}</Each></View></If>
    <If when={!nav.searchText().trim() && s.searchHistory().length > 0}><View><SectionTitle title="最近搜索" action="清空" onPress={s.clearSearchHistory} /><Each of={s.searchHistory()}>{value => <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52 }}><Press label={value()} onPress={() => run(value())} style={{ flex: 1, flexDirection: "row", gap: 16, alignItems: "center", padding: 12 }}><Icon name="clock" size={20} color={c().sub} /><Label lines={1} style={{ flex: 1 }}>{value()}</Label></Press><Tool icon="close" label={`移除 ${value()}`} onPress={() => s.removeSearchHistory(value())} /></View>}</Each></View></If>
    <If when={s.searching()}><Label color={c().accent}>正在搜索「{s.query()}」…</Label></If>
    <If when={s.query() && !suggesting()}><View style={{ gap: 24 }}>
      <If when={songs().length > 0}><View><SectionTitle title={nav.searchType() === "all" ? "歌曲" : `歌曲 · ${songs().length}`} /><TrackList tracks={songs()} title={`搜索：${s.query()}`} /></View></If>
      <If when={collections().length > 0}><View><If when={nav.searchType() === "all"}><SectionTitle title="专辑、歌手与歌单" /></If><If when={s.settings().libraryView === "list"} else={<View style={{ flexDirection: "row", flexWrap: "wrap", gap: narrow() ? 16 : 24 }}><Each of={collections()}>{item => <MusicCard item={item()} />}</Each></View>}><Each of={collections()}>{item => <CollectionRow item={item()} />}</Each></If></View></If>
      <If when={!s.searchResults().length && !s.searching()}><Empty icon="search" title="没有找到结果" description={`试试其他关键词，或搜索歌手的名字。`} /></If>
      <If when={s.searchContinuation()}><Pill label={s.searching() ? "正在加载…" : "加载更多"} disabled={s.searching()} onPress={() => void s.loadMoreSearch()} testID="search-more" /></If>
    </View></If>
    <If when={!s.query() && !s.searchHistory().length && !nav.searchText()}><Empty icon="search" title="搜索音乐" description="歌曲、专辑、歌手与歌单"><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}><Each of={["Hatsune Miku", "Laufey", "YOASOBI"]}>{value => <Pill label={value()} onPress={() => run(value())} />}</Each></View></Empty></If>
  </View>;
}
