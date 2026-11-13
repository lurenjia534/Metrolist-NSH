import { Icon as Glyph, type IconColor, type IconName } from "./spotish/components/ui/icons";

// One family of glyphs for both workspaces: the Spotify workspace's Tabler
// set (src/spotish/components/ui/icons.tsx). The YouTube Music screens name
// them as they always have; this maps those names onto the set.
const names: Record<string, IconName> = {
  album: "disc", artist: "user", users: "users", stats: "chartBar", grid: "layoutGrid", list: "list", sort: "sort",
  share: "share", info: "info", refresh: "refresh", checkCircle: "circleCheck", storage: "database", bookmark: "bookmark",
  edit: "pencil", home: "home", search: "search", compass: "compass", library: "library", heart: "heart", clock: "clock",
  settings: "settings", plus: "plus", play: "play", pause: "pause", next: "skipForward", previous: "skipBack",
  shuffle: "shuffle", repeat: "repeat", repeatOne: "repeatOne", volume: "volume", mute: "volumeMute", queue: "playlist",
  lyrics: "microphone", down: "chevronDown", up: "chevronUp", right: "chevronRight", left: "chevronLeft", close: "close",
  more: "dots", music: "music", download: "download", upload: "upload", link: "link", spark: "sparkles", sun: "sun",
  moon: "moon", arrow: "arrowRight", radio: "broadcast", check: "check", trash: "trash", expand: "maximize",
  headphones: "headphones", panel: "sidebarRight", logIn: "logIn", circle: "circle", external: "externalLink",
  sidebarCollapse: "sidebarCollapse", sidebarExpand: "sidebarExpand", user: "user", logOut: "logOut", alert: "alert",
};

export const glyph = (name: string, filled?: boolean): IconName =>
  name === "heart" && filled ? "heartFilled" : names[name] ?? (name as IconName);

/** A glyph in `color` (a hex colour, or a theme token's name). */
export function Icon(props: { name: string; size?: number; color?: string; filled?: boolean }) {
  const hex = () => props.color?.startsWith("#") ? props.color : undefined;
  return <Glyph name={glyph(props.name, props.filled)} size={props.size ?? 20} color={(hex() ? undefined : props.color ?? "muted-foreground") as IconColor | undefined} hex={hex()} />;
}
