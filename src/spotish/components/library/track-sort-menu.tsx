// The control above a playlist's tracks that picks their order and view.

import { signal, Text, View } from "nsh";
import { Button, Menu, MenuItem, MenuSeparator } from "nsh/base";
import { focusRing, menuItem, popupSurface, terminal } from "../ui/controls";
import { Icon } from "../ui/icons";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "../ui/menu";
import { chooseSort, directionOf, TRACK_SORTS, trackReversed, trackSort, trackView, type TrackView } from "./track-sort";

const VIEWS: { id: TrackView; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "list", label: "List" },
];

/** The way the chosen order runs, as an arrow (none for custom order). */
const arrow = () => (trackSort() === "custom" ? "" : directionOf(trackSort(), trackReversed()) === "asc" ? "↑" : "↓");

const Heading = (props: { label: string }) => (
  <Text class="px-3 pb-1 pt-2 text-xs font-bold text-muted-foreground">{props.label}</Text>
);

/** A button showing the order in use, which opens a menu to change the
 * order and the view. */
export function TrackSortMenu() {
  const open = signal(false);
  const label = () => TRACK_SORTS.find((s) => s.id === trackSort())?.label ?? "";
  return (
    <View class={terminal ? "" : "mx-3 h-9 flex-row items-center justify-end px-3"}>
      <Menu
        open={open()}
        onOpenChange={(e) => open.set(e.open)}
        placement="bottom"
        align="end"
        offset={4}
        popupClass={popupSurface}
        popupStyle={menuPopupStyle("bottom", "end")}
        popupStartingStyle={menuPopupHidden("bottom", "end")}
        popupEndingStyle={menuPopupLeaving("bottom", "end")}
        trigger={
          <Button
            accessibilityLabel={`Sort tracks: ${label()} ${arrow()}`.trim()}
            selected={open()}
            class={
              terminal
                ? "px-1 focus:bg-muted"
                : `group h-7 flex-row items-center gap-1 rounded-(--radius-inset) px-2 transition duration-200 ease-out hover:bg-row-hover selected:bg-secondary motion-reduce:transition-none ${focusRing}`
            }
          >
            <Text class="text-xs font-medium text-muted-foreground group-hover:text-foreground">{`${label()} ${arrow()}`.trim()}</Text>
            <If when={!terminal}>
              <Icon name="chevronDown" size={12} color="muted-foreground" />
            </If>
          </Button>
        }
      >
        <Heading label="Sort by" />
        {TRACK_SORTS.map((sort) => (
          <MenuItem onSelect={() => chooseSort(sort.id)} checked={trackSort() === sort.id} class={menuItem}>
            <Text class="flex-1 text-sm text-popover-foreground">{sort.label}</Text>
            <If when={trackSort() === sort.id && trackSort() !== "custom"}>
              <Text class="text-sm text-popover-foreground">{arrow()}</Text>
            </If>
            <If when={trackSort() === sort.id && !terminal}>
              <Icon name="check" size={14} color="popover-foreground" />
            </If>
          </MenuItem>
        ))}
        <MenuSeparator class={terminal ? "hidden" : "-mx-1 my-1 h-px bg-border"} />
        <Heading label="View as" />
        {VIEWS.map((view) => (
          <MenuItem onSelect={() => trackView.set(view.id)} checked={trackView() === view.id} class={menuItem}>
            <Text class="flex-1 text-sm text-popover-foreground">{view.label}</Text>
            <If when={trackView() === view.id && !terminal}>
              <Icon name="check" size={14} color="popover-foreground" />
            </If>
          </MenuItem>
        ))}
      </Menu>
    </View>
  );
}
