import { Scroll, Text, View, computed, untracked, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { isTrack, type CatalogSection, type Collection, type Mood, type Track } from "../model";
import { Pill, TextAction, ROW, narrow, action } from "../ui";
import { CardGrid, CardRow, CollectionRow, TrackRow } from "./Music";
import { pageWave } from "./Page";
import { Cover } from "../spotish/components/ui/controls";
import { SectionTitle as SpotishSectionTitle } from "../spotish/components/ui/controls";
import { waveDelay, type ListWave } from "../spotish/components/ui/motion";

/** Moods and genres: tiles with their colour along the left edge. */
export function MoodGrid(props: { moods: Mood[]; testID: string; horizontal?: boolean; rows?: number }) {
  const rows = () => props.rows || 4;
  const columns = computed(() => Array.from({ length: Math.ceil(props.moods.length / rows()) }, (_, index) => props.moods.slice(index * rows(), (index + 1) * rows())));
  const tile = (mood: Mood, index: number) => <View testID={`${props.testID}-mood-${index}`} role="button" accessibilityLabel={mood.title}
    onPress={() => nav.openBrowse({ browseId: mood.browseId, params: mood.params }, mood.title)}
    class={`min-h-14 justify-center overflow-hidden rounded-(--radius) bg-secondary px-4 py-3 ${ROW}`}
    style={{ flexGrow: props.horizontal ? 0 : 1, flexBasis: props.horizontal ? undefined : narrow() ? "44%" : "22%", borderLeftWidth: mood.color ? 4 : 0, borderLeftColor: mood.color }}>
    <Text class="line-clamp-2 text-sm font-bold text-foreground">{mood.title}</Text>
  </View>;
  return <If when={props.horizontal} else={<View class="flex-row flex-wrap gap-3 px-3"><Each of={props.moods}>{(mood, index) => tile(mood(), index())}</Each></View>}>
    <Scroll horizontal scrollbar={false} style={{ height: Math.min(rows(), props.moods.length) * 68 }} contentClass="flex-row gap-3 px-3">
      <Each of={columns()}>{(column, index) => <View class="gap-3" style={{ width: narrow() ? Math.min(224, (windowSize().width - 36) / 2) : 240 }}><Each of={column()}>{(mood, row) => tile(mood(), index() * rows() + row())}</Each></View>}</Each>
    </Scroll>
  </If>;
}

/** A section of Home, Explore or a collection: its title (and what it is
 * over it), Play all and Show all, then its items as a row of cards, a grid,
 * or columns of tracks; every kind comes in as a wave a little after the
 * sections above it. */
export function CatalogShelf(props: { section: CatalogSection; testID: string; index?: number; wave?: ListWave }) {
  const wave = untracked(() => (props.wave ?? pageWave()));
  const delay = untracked(() => waveDelay(props.index ?? 0, 4));
  const rowsWave = untracked(() => wave.child(delay));
  const songs = computed(() => props.section.items.filter(isTrack));
  const list = () => props.section.layout === "list" || !props.section.layout && songs().length === props.section.items.length;
  const rows = () => props.section.rows || 4;
  const columns = computed(() => Array.from({ length: Math.ceil(props.section.items.length / rows()) }, (_, index) => props.section.items.slice(index * rows(), (index + 1) * rows())));
  const more = () => nav.openBrowse(props.section.endpoint!, props.section.title);
  const play = () => action(() => props.section.playEndpoint ? s.playEndpoint(props.section.playEndpoint, props.section.title) : p.playList(songs(), 0, props.section.title));
  return <If when={props.section.items.length > 0 || props.section.moods?.length}><View testID={props.testID} class="gap-2">
    <View class="flex-row items-end gap-3 px-3">
      <View class="min-w-0 flex-1 flex-row items-center gap-3">
        <If when={props.section.thumbnail}><Cover src={props.section.thumbnail!} size={40} round /></If>
        <View class="min-w-0 flex-1 gap-0.5">
          <If when={props.section.label}><Text class="line-clamp-1 text-xs font-medium text-muted-foreground">{props.section.label}</Text></If>
          <SpotishSectionTitle class="line-clamp-2">{props.section.title}</SpotishSectionTitle>
        </View>
      </View>
      <View class="flex-row items-center gap-2">
        <If when={props.section.playEndpoint || songs().length > 0}><Pill testID={`${props.testID}-play`} label="播放全部" icon="play" disabled={p.remoteControlled()} onPress={play} /></If>
        <If when={props.section.endpoint}><TextAction testID={`${props.testID}-more`} label="显示全部" onPress={more} /></If>
      </View>
    </View>
    <If when={props.section.moods?.length}><MoodGrid testID={props.testID} moods={props.section.moods!} horizontal rows={props.section.rows} /></If>
    <If when={props.section.items.length > 0}><If when={list()} else={<If when={props.section.layout === "grid"} else={<CardRow testID={`${props.testID}-cards`} items={props.section.items} wave={wave} delay={delay} class="px-3" />}><View class="px-3"><CardGrid items={props.section.items} wave={wave} delay={delay} /></View></If>}>
      <Scroll horizontal scrollbar={false} style={{ height: Math.min(rows(), props.section.items.length) * 60 + 4 }} contentClass="flex-row gap-3">
        <Each of={columns()}>{(column, at) => <View style={{ width: narrow() ? Math.min(360, windowSize().width - 40) : 380 }}><Each of={column()}>{(item, row) => <View class="pb-1"><If when={isTrack(item())} else={<CollectionRow item={item() as Collection} wave={rowsWave} index={at() * rows() + row()} />}><TrackRow track={item() as Track} list={songs()} index={at() * rows() + row()} numbered={false} compact wave={rowsWave} /></If></View>}</Each></View>}</Each>
      </Scroll>
    </If></If>
  </View></If>;
}
