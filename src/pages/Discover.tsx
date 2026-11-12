import { View, Scroll, computed, cleanup } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { isTrack, type Collection, type SearchType, type ExploreTab } from "../model";
import { parseMusicLink } from "../musicLinks";
import { CatalogShelf, MoodGrid } from "../components/Discovery";
import { Icon } from "../icons";
import { TrackList, MusicCard, CollectionRow } from "../components/Music";
import { Label, Tool, Pill, Chip, Field, SectionTitle, Empty, Press, palette as c, narrow, action } from "../ui";

export { HomePage } from "./Home";

export function ExplorePage() {
  const refresh = () => s.exploreEndpoint() ? s.loadExploreEndpoint(s.exploreEndpoint()!) : s.loadExplore();
  const groupedMoods = () => s.explore().sections.some(section => section.moods?.length);
  return <View testID="page-browse" style={{ gap: 24 }}>
    <If when={!s.exploreEndpoint()}><Scroll horizontal scrollbar={false} style={{ height: 52, flexShrink: 0 }} contentStyle={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}><Each of={[{ tab: "all", label: "全部" }, { tab: "new", label: "新发行" }, { tab: "charts", label: "排行榜" }, { tab: "moods", label: "心情与流派" }] as const}>{item => <Chip label={item().label} selected={s.exploreTab() === item().tab} onPress={() => nav.openExplore(item().tab)} />}</Each></Scroll></If>
    <If when={s.exploreLoading()}><Label color={c().accent}>正在加载…</Label></If>
    <If when={!groupedMoods() && s.explore().moods.length > 0}><MoodGrid testID="explore-moods" moods={s.explore().moods} /></If>
    <Each of={s.explore().sections}>{(section, index) => <CatalogShelf section={section()} testID={`explore-section-${index()}`} />}</Each>
    <If when={s.explore().continuation}><Pill testID="explore-more" label={s.exploreLoading() ? "正在加载…" : "加载更多"} disabled={s.exploreLoading()} onPress={() => void s.loadMoreExplore()} /></If>
    <If when={!s.exploreLoading() && !s.explore().sections.length && !s.explore().moods.length}><Empty icon="compass" title="还没有发现内容" description="刷新获取当前地区的音乐推荐。" /></If>
    <View style={{ alignItems: "center" }}><Pill testID="explore-refresh" label="刷新" icon="refresh" disabled={s.exploreLoading()} onPress={() => void refresh()} /></View>
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
  const discover = (tab: ExploreTab, title: string) => nav.openExplore(tab, title);
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
