import { View, Scroll, computed, signal, cleanup, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { isTrack, type Collection, type SearchType, type ExploreTab } from "../model";
import { parseMusicLink } from "../musicLinks";
import { Icon } from "../icons";
import { TrackRow, TrackList, MusicCard, ItemRail, CollectionRow } from "../components/Music";
import { Label, Tool, Pill, Chip, Field, SectionTitle, Empty, Press, palette as c, narrow, pageGutter, action } from "../ui";

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
    <If when={narrow()}><HomeShortcuts /></If>
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
  const link = computed(() => parseMusicLink(nav.searchText()));
  const suggesting = () => nav.searchText().trim() !== s.query() || !s.query();
  const change = (value: string) => {
    nav.searchText.set(value);
    clearTimeout(timer);
    void s.loadSuggestions("");
    if (value.trim() && !parseMusicLink(value)) timer = setTimeout(() => void s.loadSuggestions(value), 180);
  };
  const recent = computed(() => s.searchHistory().filter(value => value.toLocaleLowerCase().includes(nav.searchText().trim().toLocaleLowerCase())));
  const suggestions = computed(() => s.searchSuggestions().filter(value => !recent().includes(value)));
  const songs = computed(() => s.searchResults().filter(isTrack));
  const groups = computed(() => ([
    { type: "artist", searchType: "artists", title: "歌手" },
    { type: "album", searchType: "albums", title: "专辑" },
    { type: "playlist", searchType: "playlists", title: "歌单" },
  ] as const).map(group => ({ ...group, items: s.searchResults().filter(item => !isTrack(item) && item.type === group.type) as Collection[] })).filter(group => group.items.length));
  const run = (value = nav.searchText(), type = nav.searchType()) => { clearTimeout(timer); nav.performSearch(value, type); };
  const discover = (tab: ExploreTab, title: string) => { nav.browseTitle.set(title); nav.navigate("browse"); void s.loadExplore(tab); };
  return <View testID="page-search" style={{ gap: 24 }}>
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Field testID="search-input" value={nav.searchText()} onChange={change} placeholder="搜索音乐或粘贴 YouTube Music 链接" onSubmit={() => run()} /><Tool icon="search" label="搜索" testID="search-submit" onPress={() => run()} /><If when={nav.searchText()}><Tool icon="close" label="清空输入" onPress={() => change("")} /></If></View>
    <Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={[{ type: "all", label: "全部" }, { type: "songs", label: "歌曲" }, { type: "albums", label: "专辑" }, { type: "artists", label: "歌手" }, { type: "playlists", label: "歌单" }] as const}>{item => <Chip testID={`search-filter-${item().type}`} label={item().label} selected={nav.searchType() === item().type} onPress={() => { nav.searchType.set(item().type as SearchType); if (nav.searchText().trim() && !link()) run(); }} />}</Each></Scroll>
    <If when={link()}>{parsed => <View testID="search-link" style={{ padding: 20, borderRadius: 20, gap: 16, backgroundColor: c().selected }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}><Icon name="link" size={26} color={c().accent} /><View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Label weight="600">已识别{{ song: "歌曲", album: "专辑", artist: "歌手", playlist: "歌单" }[parsed().type]}链接</Label>
        <Label size={13} color={c().sub}>{parsed().type === "song" ? together.isGuest() ? "把这首歌加入一起听的点歌请求。" : "直接收听这首歌曲。" : "打开音乐详情，继续播放或收藏。"}</Label>
      </View></View>
      <View style={{ alignItems: "flex-start" }}><Pill testID="search-open-link" primary icon={parsed().type === "song" ? "play" : "right"} label={parsed().type === "song" ? together.isGuest() ? "请求播放" : "播放歌曲" : `打开${{ album: "专辑", artist: "歌手", playlist: "歌单", song: "歌曲" }[parsed().type]}`} onPress={() => run()} /></View>
    </View>}</If>
    <If when={suggesting() && !link() && recent().length > 0}><View testID="search-history"><SectionTitle title="最近搜索" action={!nav.searchText().trim() ? "清空" : undefined} onPress={s.clearSearchHistory} />
      <Each of={recent()}>{(value, index) => <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52 }}><Press label={value()} onPress={() => run(value())} style={{ flex: 1, flexDirection: "row", gap: 12, alignItems: "center", padding: 12 }}><Icon name="clock" size={20} color={c().sub} /><Label lines={1} style={{ flex: 1 }}>{value()}</Label></Press><Tool testID={`search-history-fill-${index()}`} icon="arrow" label={`填入搜索词 ${value()}`} onPress={() => change(value())} /><Tool icon="close" label={`移除 ${value()}`} onPress={() => s.removeSearchHistory(value())} /></View>}</Each>
    </View></If>
    <If when={suggesting() && !link() && suggestions().length > 0}><View testID="search-suggestions" style={{ gap: 4 }}><Label color={c().sub} size={12} style={{ paddingHorizontal: 12, marginBottom: 4 }}>搜索建议</Label>
      <Each of={suggestions()}>{(value, index) => <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52 }}><Press label={`搜索 ${value()}`} onPress={() => run(value())} style={{ flex: 1, minHeight: 52, alignItems: "center", flexDirection: "row", gap: 12, paddingHorizontal: 12 }}><Icon name="search" size={20} color={c().sub} /><Label lines={1} style={{ flex: 1 }}>{value()}</Label></Press><Tool testID={`search-suggestion-fill-${index()}`} icon="arrow" label={`填入搜索词 ${value()}`} onPress={() => change(value())} /></View>}</Each>
    </View></If>
    <If when={s.searching() && !suggesting() && !link()}><Label color={c().accent}>正在搜索「{s.query()}」…</Label></If>
    <If when={s.query() && !suggesting() && !link()}><View style={{ gap: 28 }}>
      <If when={songs().length > 0}><View testID="search-group-songs"><SectionTitle title={`歌曲 · ${songs().length}`} action="播放全部" icon="play" disabled={p.remoteControlled()} onPress={() => action(() => p.playList(songs(), 0, `搜索：${s.query()}`))} /><TrackList tracks={songs()} title={`搜索：${s.query()}`} /></View></If>
      <Each of={groups()}>{group => <View testID={`search-group-${group().searchType}`}><SectionTitle title={`${group().title} · ${group().items.length}`} action={nav.searchType() === "all" ? `更多${group().title}` : undefined} icon="right" onPress={() => run(s.query(), group().searchType)} />
        <If when={s.settings().libraryView === "list"} else={<View style={{ flexDirection: "row", flexWrap: "wrap", gap: narrow() ? 16 : 24 }}><Each of={group().items}>{item => <MusicCard item={item()} />}</Each></View>}><Each of={group().items}>{item => <CollectionRow item={item()} />}</Each></If>
      </View>}</Each>
      <If when={!s.searchResults().length && !s.searching()}><Empty icon="search" title="没有找到结果" description={`试试其他关键词，或搜索歌手的名字。`} /></If>
      <If when={s.searchContinuation()}><Pill label={s.searching() ? "正在加载…" : "加载更多"} disabled={s.searching()} onPress={() => void s.loadMoreSearch()} testID="search-more" /></If>
    </View></If>
    <If when={!nav.searchText().trim()}><View testID="search-discover"><SectionTitle title="发现音乐" subtitle="从新发行、榜单或喜欢的风格开始" /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <Each of={[{ tab: "new", title: "新发行", detail: "新歌与新专辑", icon: "spark" }, { tab: "charts", title: "排行榜", detail: "正在流行的音乐", icon: "stats" }, { tab: "moods", title: "心情与流派", detail: "找到此刻的声音", icon: "compass" }] as const}>{item => <Press testID={`search-discover-${item().tab}`} label={item().title} onPress={() => discover(item().tab, item().title)} style={{ flexGrow: 1, flexBasis: narrow() ? "100%" : "30%", minWidth: 0, minHeight: 92, padding: 20, gap: 14, borderRadius: 20, backgroundColor: c().card, flexDirection: "row", alignItems: "center" }}><Icon name={item().icon} size={26} color={c().accent} /><View style={{ flex: 1, gap: 6, minWidth: 0 }}><Label weight="600">{item().title}</Label><Label size={12} color={c().sub}>{item().detail}</Label></View><Icon name="right" size={18} color={c().faint} /></Press>}</Each>
    </View></View></If>
  </View>;
}
