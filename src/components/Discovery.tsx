import { Scroll, View, computed, windowSize } from "nsh";
import * as s from "../store";
import * as p from "../playback";
import * as nav from "../navigation";
import { isTrack, type CatalogSection, type Collection, type Mood, type Track } from "../model";
import { Art, Label, Pill, Press, Tool, palette as c, narrow, pageGutter, action } from "../ui";
import { CollectionRow, ItemRail, MusicCard, TrackRow } from "./Music";

export function MoodGrid(props: { moods: Mood[]; testID: string; horizontal?: boolean; rows?: number }) {
  const rows = () => props.rows || 4;
  const columns = computed(() => Array.from({ length: Math.ceil(props.moods.length / rows()) }, (_, index) => props.moods.slice(index * rows(), (index + 1) * rows())));
  const tile = (mood: Mood, index: number) => <Press testID={`${props.testID}-mood-${index}`} label={mood.title}
    onPress={() => nav.openBrowse({ browseId: mood.browseId, params: mood.params }, mood.title)}
    style={{ flexGrow: props.horizontal ? 0 : 1, flexBasis: props.horizontal ? undefined : narrow() ? "44%" : "22%", minWidth: 0, minHeight: 56, justifyContent: "center", borderRadius: 12, backgroundColor: c().card, borderLeftWidth: mood.color ? 5 : 0, borderLeftColor: mood.color, paddingHorizontal: 14, paddingVertical: 12 }}>
    <Label size={15} weight="600" lines={2}>{mood.title}</Label>
  </Press>;
  return <If when={props.horizontal} else={<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Each of={props.moods}>{(mood, index) => tile(mood(), index())}</Each></View>}>
    <Scroll horizontal scrollbar={false} style={{ height: Math.min(rows(), props.moods.length) * 68 }} contentStyle={{ flexDirection: "row", gap: 12 }}>
      <Each of={columns()}>{(column, index) => <View style={{ width: narrow() ? Math.min(224, (windowSize().width - pageGutter() * 2 - 12) / 2) : 240, gap: 12 }}><Each of={column()}>{(mood, row) => tile(mood(), index() * rows() + row())}</Each></View>}</Each>
    </Scroll>
  </If>;
}

export function CatalogShelf(props: { section: CatalogSection; testID: string }) {
  const songs = computed(() => props.section.items.filter(isTrack));
  const list = () => props.section.layout === "list" || !props.section.layout && songs().length === props.section.items.length;
  const rows = () => props.section.rows || 4;
  const columns = computed(() => Array.from({ length: Math.ceil(props.section.items.length / rows()) }, (_, index) => props.section.items.slice(index * rows(), (index + 1) * rows())));
  const more = () => nav.openBrowse(props.section.endpoint!, props.section.title);
  const play = () => action(() => props.section.playEndpoint ? s.playEndpoint(props.section.playEndpoint, props.section.title) : p.playList(songs(), 0, props.section.title));
  return <If when={props.section.items.length > 0 || props.section.moods?.length}><View testID={props.testID} style={{ gap: 16 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <View style={{ flexGrow: 1, flexBasis: 160, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}><If when={props.section.thumbnail}><Art src={props.section.thumbnail} size={48} radius={8} /></If>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}><If when={props.section.label}><Label size={12} color={c().sub} lines={1}>{props.section.label}</Label></If><Label size={narrow() ? 23 : 26} weight="700" lines={2}>{props.section.title}</Label></View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><If when={props.section.playEndpoint || songs().length > 0}><Pill testID={`${props.testID}-play`} label="播放全部" icon="play" disabled={p.remoteControlled()} onPress={play} /></If>
        <If when={props.section.endpoint}><Tool testID={`${props.testID}-more`} label={`更多${props.section.title}`} icon="right" onPress={more} /></If>
      </View>
    </View>
    <If when={props.section.moods?.length}><MoodGrid testID={props.testID} moods={props.section.moods!} horizontal rows={props.section.rows} /></If>
    <If when={props.section.items.length > 0}><If when={list()} else={<If when={props.section.layout === "grid"} else={<ItemRail items={props.section.items} all />}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}><Each of={props.section.items}>{item => <MusicCard item={item()} list={songs()} />}</Each></View></If>}>
      <Scroll horizontal scrollbar={false} style={{ height: Math.min(rows(), props.section.items.length) * (songs().length === props.section.items.length ? 68 : 76) + 4 }} contentStyle={{ flexDirection: "row", gap: 16 }}>
        <Each of={columns()}>{column => <View style={{ width: narrow() ? Math.min(350, (windowSize().width - pageGutter() * 2) * 0.94) : 350, gap: 0 }}><Each of={column()}>{item => <If when={isTrack(item())} else={<CollectionRow item={item() as Collection} />}><TrackRow track={item() as Track} list={songs()} compact /></If>}</Each></View>}</Each>
      </Scroll>
    </If></If>
  </View></If>;
}
