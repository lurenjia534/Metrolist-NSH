import { Scroll, Text, View, computed, effect, untracked } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import * as together from "../together";
import { isTrack, type Collection, type SearchType, type ExploreTab } from "../model";
import { parseMusicLink } from "../musicLinks";
import { CatalogShelf, MoodGrid } from "../components/Discovery";
import { Icon } from "../icons";
import { TrackList, CardRow, CollectionRow } from "../components/Music";
import { Heading, SearchInput, changeSearch, pageWave, runSearch } from "../components/Page";
import { Chip, Empty, Pill, SectionTitle, ROW, action } from "../ui";
import { layout, narrowDesktopHeader, pageEnd, systemHeader } from "../layout";
import { IconButton } from "../spotish/components/ui/controls";
import { Reveal, SearchSkeleton, Spinner } from "../spotish/components/ui/feedback";
import { enter, waveDelay } from "../spotish/components/ui/motion";

export { HomePage } from "./Home";

const exploreTabs = [{ tab: "all", label: "全部" }, { tab: "new", label: "新发行" }, { tab: "charts", label: "排行榜" }, { tab: "moods", label: "心情与流派" }] as const;

export function ExplorePage() {
  const refresh = () => s.exploreEndpoint() ? s.loadExploreEndpoint(s.exploreEndpoint()!) : s.loadExplore();
  const groupedMoods = () => s.explore().sections.some(section => section.moods?.length);
  const has = () => s.explore().sections.length > 0 || s.explore().moods.length > 0;
  return <View testID="page-browse" class="gap-8">
    <If when={!s.exploreEndpoint()}><Scroll horizontal scrollbar={false} class="h-11 shrink-0" contentClass="flex-row items-center gap-2 px-3"><Each of={exploreTabs}>{item => <Chip label={item().label} selected={s.exploreTab() === item().tab} onPress={() => nav.openExplore(item().tab)} />}</Each></Scroll></If>
    <Reveal data={has() ? s.explore() : null} placeholder={<If when={s.exploreLoading()} else={<Empty icon="compass" title="还没有发现内容" description="刷新获取当前地区的音乐推荐。" />}><SearchSkeleton /></If>}>
      {(explore, instant) => {
        const wave = pageWave({ afterReveal: !instant });
        effect(() => { explore().sections; untracked(() => wave.restart()); });
        return <View class="gap-8">
          <If when={!groupedMoods() && explore().moods.length > 0}><MoodGrid testID="explore-moods" moods={explore().moods} /></If>
          <Each of={explore().sections}>{(section, index) => <CatalogShelf section={section()} testID={`explore-section-${index()}`} index={index()} wave={wave} />}</Each>
        </View>;
      }}
    </Reveal>
    <If when={s.explore().continuation}><View class="items-center"><Pill testID="explore-more" label={s.exploreLoading() ? "正在加载…" : "加载更多"} disabled={s.exploreLoading()} onPress={() => void s.loadMoreExplore()} /></View></If>
    <View class="items-center"><Pill testID="explore-refresh" label="刷新" icon="refresh" disabled={s.exploreLoading()} onPress={() => void refresh()} /></View>
  </View>;
}

const filters = [{ type: "all", label: "全部" }, { type: "songs", label: "歌曲" }, { type: "albums", label: "专辑" }, { type: "artists", label: "歌手" }, { type: "playlists", label: "歌单" }] as const;
const discover = [{ tab: "new", title: "新发行", detail: "新歌与新专辑", icon: "spark" }, { tab: "charts", title: "排行榜", detail: "正在流行的音乐", icon: "stats" }, { tab: "moods", title: "心情与流派", detail: "找到此刻的声音", icon: "compass" }] as const;

/** A remembered search or a suggestion: search it, put it in the field, or forget it. */
function SuggestionRow(props: { value: string; icon: string; testID: string; onRemove?: () => void }) {
  return <View class={`group min-h-12 flex-row items-center rounded-(--radius) pr-1 ${ROW}`}>
    <View role="button" accessibilityLabel={props.onRemove ? props.value : `搜索 ${props.value}`} onPress={() => runSearch(props.value)} class="min-h-12 min-w-0 flex-1 flex-row items-center gap-3 px-3">
      <Icon name={props.icon} size={18} color="muted-foreground" /><Text class="line-clamp-1 flex-1 text-sm text-foreground">{props.value}</Text>
    </View>
    <IconButton testID={props.testID} name="arrowRight" label={`填入搜索词 ${props.value}`} onPress={() => changeSearch(props.value)} />
    <If when={props.onRemove}><IconButton name="close" label={`移除 ${props.value}`} onPress={() => props.onRemove!()} /></If>
  </View>;
}

/** Search, as the Spotify workspace's (src/spotish/pages/search.tsx): the
 * field (the header's on a wide desktop), what was searched before or what
 * to search, a skeleton until results come, then the songs in a wave and
 * the artists, albums and playlists as rows of cards. */
export function SearchPage(props: { route: nav.Route }) {
  const link = computed(() => parseMusicLink(nav.searchText()));
  const suggesting = () => nav.searchText().trim() !== s.query() || !s.query();
  const recent = computed(() => s.searchHistory().filter(value => value.toLocaleLowerCase().includes(nav.searchText().trim().toLocaleLowerCase())));
  const suggestions = computed(() => s.searchSuggestions().filter(value => !recent().includes(value)));
  const songs = computed(() => s.searchResults().filter(isTrack));
  const groups = computed(() => ([
    { type: "artist", searchType: "artists", title: "歌手" },
    { type: "album", searchType: "albums", title: "专辑" },
    { type: "playlist", searchType: "playlists", title: "歌单" },
  ] as const).map(group => ({ ...group, items: s.searchResults().filter(item => !isTrack(item) && item.type === group.type) as Collection[] })).filter(group => group.items.length));
  const showResults = () => !!s.query() && !suggesting() && !link();
  const fieldInPage = () => systemHeader || layout() !== "desktop" || narrowDesktopHeader();
  return <Scroll testID="content-search" class="min-h-0 min-w-0 flex-1" contentClass={`px-3 pt-1 ${pageEnd()}`} keyboardShouldPersistTaps="handled">
    <View testID="page-search" class="w-full min-w-0 max-w-[1600px] gap-6 self-center">
      <If when={!systemHeader}><Heading route={props.route} inset /></If>
      <If when={fieldInPage()}><View class="flex-row items-center gap-3 px-3"><SearchInput /><If when={s.searching()}><Spinner label="正在搜索" /></If></View></If>
      <Scroll horizontal scrollbar={false} class="h-11 shrink-0" contentClass="flex-row items-center gap-2 px-3"><Each of={filters}>{item => <Chip testID={`search-filter-${item().type}`} label={item().label} selected={nav.searchType() === item().type} onPress={() => { nav.searchType.set(item().type as SearchType); if (nav.searchText().trim() && !link()) runSearch(); }} />}</Each></Scroll>
      <If when={link()}>{parsed => <View testID="search-link" class="mx-3 gap-4 rounded-(--radius-panel) border border-border bg-card p-5" style={enter("fadeInUp")}>
        <View class="flex-row items-center gap-4"><View class="size-11 items-center justify-center rounded-full bg-secondary"><Icon name="link" size={20} color="foreground" /></View><View class="min-w-0 flex-1 gap-1">
          <Text class="text-base font-bold text-foreground">已识别{{ song: "歌曲", album: "专辑", artist: "歌手", playlist: "歌单" }[parsed().type]}链接</Text>
          <Text class="text-sm text-muted-foreground">{parsed().type === "song" ? together.isGuest() ? "把这首歌加入一起听的点歌请求。" : "直接收听这首歌曲。" : "打开音乐详情，继续播放或收藏。"}</Text>
        </View></View>
        <View class="items-start"><Pill testID="search-open-link" primary icon={parsed().type === "song" ? "play" : "right"} label={parsed().type === "song" ? together.isGuest() ? "请求播放" : "播放歌曲" : `打开${{ album: "专辑", artist: "歌手", playlist: "歌单", song: "歌曲" }[parsed().type]}`} onPress={() => runSearch()} /></View>
      </View>}</If>
      <If when={suggesting() && !link() && recent().length > 0}><View testID="search-history" class="gap-1"><View class="px-3"><SectionTitle title="最近搜索" action={!nav.searchText().trim() ? "清空" : undefined} onPress={s.clearSearchHistory} /></View>
        <Each of={recent()}>{(value, index) => <SuggestionRow value={value()} icon="clock" testID={`search-history-fill-${index()}`} onRemove={() => s.removeSearchHistory(value())} />}</Each>
      </View></If>
      <If when={suggesting() && !link() && suggestions().length > 0}><View testID="search-suggestions" class="gap-1"><Text class="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">搜索建议</Text>
        <Each of={suggestions()}>{(value, index) => <SuggestionRow value={value()} icon="search" testID={`search-suggestion-fill-${index()}`} />}</Each>
      </View></If>
      <If when={!!s.query() && !link() && !suggesting()}>
        <Reveal data={s.searching() && !s.searchResults().length ? null : { query: s.query(), results: s.searchResults() }} placeholder={<SearchSkeleton />}>
          {(found, instant) => {
            // A new search's results come in as a wave of their own.
            const wave = pageWave({ afterReveal: !instant });
            effect(() => { found().results; untracked(() => wave.restart()); });
            return <View class="gap-8">
              <If when={songs().length > 0}><View testID="search-group-songs" class="gap-2"><View class="px-3"><SectionTitle title={`歌曲 · ${songs().length}`} action="播放全部" icon="play" disabled={p.remoteControlled()} onPress={() => action(() => p.playList(songs(), 0, `搜索：${s.query()}`))} /></View><TrackList tracks={songs()} title={`搜索：${s.query()}`} wave={wave} /></View></If>
              <Each of={groups()}>{(group, index) => <View testID={`search-group-${group().searchType}`} class="gap-2">
                <View class="px-3"><SectionTitle title={`${group().title} · ${group().items.length}`} action={nav.searchType() === "all" ? `更多${group().title}` : undefined} onPress={() => runSearch(s.query(), group().searchType)} /></View>
                <If when={s.settings().libraryView === "list"} else={<CardRow items={group().items} wave={wave} delay={waveDelay(index() + 1, 4)} class="px-3" />}><View><Each of={group().items}>{(item, at) => <View class="pb-1"><CollectionRow item={item()} wave={wave} index={at()} /></View>}</Each></View></If>
              </View>}</Each>
              <If when={!s.searchResults().length && !s.searching()}><Empty icon="search" title="没有找到结果" description="试试其他关键词，或搜索歌手的名字。" /></If>
              <If when={s.searchContinuation()}><View class="items-center"><Pill label={s.searching() ? "正在加载…" : "加载更多"} disabled={s.searching()} onPress={() => void s.loadMoreSearch()} testID="search-more" /></View></If>
            </View>;
          }}
        </Reveal>
      </If>
      <If when={!nav.searchText().trim()}><View testID="search-discover" class="gap-2 px-3"><SectionTitle title="发现音乐" subtitle="从新发行、榜单或喜欢的风格开始" /><View class="flex-row flex-wrap gap-3">
        <Each of={discover}>{(item, index) => <View testID={`search-discover-${item().tab}`} role="button" accessibilityLabel={item().title} onPress={() => nav.openExplore(item().tab as ExploreTab, item().title)} style={enter("fadeInUp", waveDelay(index(), 3))}
          class="group min-w-0 grow basis-60 flex-row items-center gap-4 rounded-(--radius-card) border border-border bg-card p-4 transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] motion-reduce:transition-none">
          <View class="size-12 items-center justify-center rounded-full bg-secondary transition duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none"><Icon name={item().icon} size={22} color="foreground" /></View>
          <View class="min-w-0 flex-1 gap-0.5"><Text class="text-base font-bold text-foreground">{item().title}</Text><Text class="text-xs text-muted-foreground">{item().detail}</Text></View>
          <Icon name="right" size={18} color="muted-foreground" />
        </View>}</Each>
      </View></View></If>
    </View>
  </Scroll>;
}
