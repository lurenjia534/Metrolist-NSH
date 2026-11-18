import { View, Scroll, signal, computed } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { TrackRow } from "../components/Music";
import { Icon } from "../icons";
import type { AlbumStats } from "../model";
import { Label, Chip, Art, Empty, Section, SectionTitle, Press, palette as c, narrow, action } from "../ui";

function HourlyActivity(props: { plays: number[]; selected: number | null; onSelect: (hour: number) => void }) {
  const peak = computed(() => Math.max(...props.plays));
  const hour = computed(() => props.selected ?? props.plays.indexOf(peak()));
  const clockHour = (value: number) => String(value).padStart(2, "0");
  return <Section title="按小时分布">
    <Scroll horizontal scrollbar={false} style={{ height: 108 }} contentStyle={{ flexDirection: "row", flexGrow: 1 }}>
      <Each of={props.plays}>{(plays, index) =>
        <Press testID={`stats-hour-${index()}`} label={`${index()} 点，${plays()} 次播放`} selected={hour() === index()}
          onPress={() => props.onSelect(index())} style={{ flexGrow: 1, minWidth: 44, alignItems: "center", justifyContent: "flex-end", gap: 6, paddingBottom: 4 }}>
          <View style={{ width: 16, height: peak() ? plays() / peak() * 76 : 0, backgroundColor: c().accent, borderRadius: 4 }} />
          <Label size={12} color={c().sub}>{clockHour(index())}</Label>
        </Press>}
      </Each>
    </Scroll>
    <Label testID="stats-hour-detail" size={13}>{clockHour(hour())}:00–{clockHour(hour())}:59 · {props.plays[hour()]} 次播放</Label>
  </Section>;
}

function RankedCollection(props: { rank: number; title: string; subtitle?: string; artwork: string; artist?: boolean; plays: number; seconds: number; onPress: () => void }) {
  return <Press label={[props.title, props.subtitle].filter(Boolean).join(" · ")} onPress={props.onPress}
    style={{ minHeight: 84, flexDirection: "row", alignItems: "center", gap: 16, padding: 8 }}>
    <Label size={14} color={c().sub} style={{ width: 20 }}>{props.rank}</Label>
    <Art src={props.artwork} icon={props.artist ? "artist" : "album"} size={56} radius={props.artist ? 40 : 6} />
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <Label weight="600" lines={1}>{props.title}</Label>
      <If when={props.subtitle}><Label size={12} color={c().sub} lines={1}>{props.subtitle}</Label></If>
      <Label size={12} color={c().sub}>{props.plays} 次 · {Math.floor(props.seconds / 60)} 分钟</Label>
    </View>
    <Icon name="right" size={20} color={c().sub} />
  </Press>;
}

function openStatsAlbum(album: AlbumStats) {
  if (album.albumId) {
    nav.browse({ id: album.albumId, browseId: album.albumId, title: album.title, subtitle: album.artist, artwork: album.artwork, type: "album" });
  } else {
    nav.performSearch([album.title, album.artist].filter(Boolean).join(" "), "albums");
  }
}

export function StatisticsPage() {
  const stats = s.statistics;
  const daily = computed(() => stats().daily.slice(-31));
  const max = computed(() => Math.max(1, ...daily().map(day => day.seconds)));
  const selectedDay = signal("");
  const selectedHour = signal<number | null>(null);
  const rankedTracks = computed(() => stats().topTracks.map(item => item.track));
  return <View testID="page-stats" style={{ gap: 28 }}>
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Each of={[{ id: "week", label: "近 7 天" }, { id: "month", label: "近 30 天" }, { id: "quarter", label: "近 90 天" }, { id: "halfYear", label: "近 180 天" }, { id: "year", label: "近一年" }, { id: "all", label: "全部时间" }] as const}>{period => <Chip label={period().label} selected={s.statsPeriod() === period().id} onPress={() => { s.statsPeriod.set(period().id); selectedDay.set(""); selectedHour.set(null); }} />}</Each></View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={[{ value: `${Math.floor(stats().totalSeconds / 60)}`, unit: "聆听分钟", icon: "headphones" }, { value: `${stats().plays}`, unit: "播放次数", icon: "play" }, { value: `${stats().uniqueTracks}`, unit: "首不同歌曲", icon: "music" }]}>{item => <View style={{ flex: 1, minWidth: 96, backgroundColor: c().card, borderRadius: 22, padding: narrow() ? 16 : 24, gap: 14 }}><Icon name={item().icon} size={24} color={c().accent} /><Label size={narrow() ? 28 : 36} weight="600">{item().value}</Label><Label size={12} color={c().sub}>{item().unit}</Label></View>}</Each></View>
    <If when={stats().plays > 0} else={<Empty icon="stats" title="从下一首开始记录" description={`累计听满 ${s.settings().historySeconds} 秒的播放会计入统计。这里只记录实际聆听的时间。`} />}>
      <Section title={stats().daily.length > 31 ? "每日聆听（最近 31 个有记录的日期）" : "每日聆听"}><View style={{ height: 160, flexDirection: "row", alignItems: "flex-end", gap: narrow() ? 4 : 8 }}><Each of={daily()}>{day => <Press label={`${day().date}，${Math.floor(day().seconds / 60)} 分钟`} onPress={() => selectedDay.set(`${day().date} · ${Math.floor(day().seconds / 60)} 分钟 · ${day().plays} 次播放`)} style={{ flex: 1, minWidth: 0, height: Math.max(4, day().seconds / max() * 150), backgroundColor: c().accent, borderRadius: 5 }} />}</Each></View><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label size={11} color={c().sub}>{daily()[0]?.date}</Label><Label size={11} color={c().sub}>{daily().at(-1)?.date}</Label></View><If when={selectedDay()}><Label size={13} color={c().accent}>{selectedDay()}</Label></If></Section>
      <HourlyActivity plays={stats().hourlyPlays} selected={selectedHour()} onSelect={selectedHour.set} />
      <View><SectionTitle title="最常听的歌曲" action="播放全部" icon="play" disabled={p.remoteControlled() || !rankedTracks().length}
        onPress={() => action(() => p.playList(rankedTracks(), 0, "最常听的歌曲"))} /><Each of={stats().topTracks.slice(0, 20)}>{(item, index) => <View><TrackRow track={item().track} rank={index() + 1} index={index()} list={rankedTracks()} /><Label size={12} color={c().faint} style={{ marginLeft: 100, marginTop: -4, marginBottom: 12 }}>{item().playCount} 次 · {Math.floor(item().seconds / 60)} 分钟</Label></View>}</Each></View>
      <If when={stats().topAlbums.length > 0}>
        <View><SectionTitle title="最常听的专辑" />
          <Each of={stats().topAlbums.slice(0, 12)}>{(album, index) =>
            <RankedCollection rank={index() + 1} title={album().title} subtitle={album().artist} artwork={album().artwork}
              plays={album().playCount} seconds={album().seconds} onPress={() => openStatsAlbum(album())} />}
          </Each>
        </View>
      </If>
      <View><SectionTitle title="最常听的歌手" />
        <Each of={stats().topArtists.slice(0, 12)}>{(artist, index) =>
          <RankedCollection artist rank={index() + 1} title={artist().name} artwork={artist().artwork} plays={artist().playCount} seconds={artist().seconds}
            onPress={() => artist().id.startsWith("UC") ? nav.browse({ id: artist().id, browseId: artist().id, title: artist().name, subtitle: "", artwork: artist().artwork, type: "artist" }) : nav.performSearch(artist().name, "artists")} />}
        </Each>
      </View>
    </If>
  </View>;
}
