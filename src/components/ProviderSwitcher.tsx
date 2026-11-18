import { Image, Text, View, platform, safeArea, token, windowSize } from "nsh";
import { Button, Menu, MenuItem, Tabs, Tab } from "nsh/base";
import { Icon } from "../icons";
import { palette } from "../ui";
import { phone } from "../layout";
import { layout as spotifyLayout } from "../spotish/components/layout";
import { focusRing, popupSurface } from "../spotish/components/ui/controls";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "../spotish/components/ui/menu";
import { activeProvider, providersReady, selectProvider, switchingProvider } from "../providers";
import logo from "../../assets/metrolist-icon.png";

const providers = [
  { id: "youtube", label: "YouTube Music", icon: "play", color: "#ef5268" },
  { id: "spotify", label: "Spotify", icon: "headphones", color: "#1db954" },
] as const;

const mobile = platform.os === "android" || platform.os === "ios";

/** A phone keeps its whole height for the music: no bar of services over
 * the pages. A root page's header is titled with the service instead
 * (`ProviderTitle`), as YouTube Music's own app heads its tabs with its
 * mark, and that title opens the services. */
export const providerInHeader = () => mobile || (activeProvider() === "spotify" ? spotifyLayout() === "phone" : phone());

/** The service, where a phone's root page has its title: pressing it lists
 * the services (a sheet on touch screens, a popup under it in a narrow
 * browser window). */
export function ProviderTitle() {
  const current = () => providers.find(provider => provider.id === activeProvider())!;
  return (
    <Menu placement="bottom" align="start" offset={4} popupClass={popupSurface} backdropClass="bg-shell/80"
      popupStyle={{ ...menuPopupStyle("bottom", "start"), minWidth: 264 }} popupStartingStyle={menuPopupHidden("bottom", "start")} popupEndingStyle={menuPopupLeaving("bottom", "start")}
      trigger={
        <Button testID="provider-switcher" accessibilityLabel={`音乐服务：${current().label}，切换服务`} disabled={!providersReady() || switchingProvider()}
          class={`h-10 shrink-0 flex-row items-center gap-2 rounded-full px-2 transition duration-150 ease-out active:opacity-60 disabled:opacity-60 motion-reduce:transition-none ${focusRing}`}>
          <Icon name={current().icon} size={20} color={current().color} />
          <Text testID="provider-current" class="text-lg font-bold text-foreground">{current().label}</Text>
          <Icon name="down" size={14} color="muted-foreground" />
        </Button>
      }>
      <Text class="px-3 pb-1 pt-2 text-xs font-bold text-muted-foreground">音乐服务</Text>
      <Each of={providers}>{provider => (
        <MenuItem testID={`provider-${provider().id}`} role="menuitemradio" checked={activeProvider() === provider().id} onSelect={() => void selectProvider(provider().id)}
          class="h-14 flex-row items-center gap-3 rounded-(--radius) px-3 hover:bg-muted focus:bg-muted active:bg-muted">
          <View class="size-9 items-center justify-center rounded-full bg-secondary"><Icon name={provider().icon} size={18} color={provider().color} /></View>
          <View class="min-w-0 flex-1 gap-0.5">
            <Text class="text-base font-semibold text-popover-foreground">{provider().label}</Text>
            <Text class="text-xs text-muted-foreground">{activeProvider() === provider().id ? "正在使用" : "切换过去，这边的播放会暂停"}</Text>
          </View>
          <If when={activeProvider() === provider().id}><Icon name="check" size={18} color="popover-foreground" /></If>
        </MenuItem>
      )}</Each>
      {/* A phone's sheet ends at the screen's edge: its rows stay clear of
          the home indicator (nothing on a desktop's popup). */}
      <View style={{ height: safeArea().bottom }} />
    </Menu>
  );
}

/** The services across the top of a desktop's or a wide browser's window. */
export function ProviderSwitcher() {
  const compact = () => windowSize().width < 900;
  const spotify = () => activeProvider() === "spotify";
  const background = () => spotify() ? token("sidebar") : palette().bg;
  const foreground = () => spotify() ? token("foreground") : palette().text;
  const muted = () => spotify() ? token("muted-foreground") : palette().sub;
  const selected = () => spotify() ? token("secondary") : palette().secondary;
  return (
    <View testID="provider-switcher" style={{ flexShrink: 0, backgroundColor: background(), paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <View style={{ minHeight: 52, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: compact() ? 8 : 18, paddingVertical: 6 }}>
        <If when={!compact()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, width: 168 }}>
            <Image src={logo} style={{ width: 26, height: 26, borderRadius: 8 }} />
            <Text style={{ color: foreground(), fontSize: 14, fontWeight: "600" }}>Metrolist</Text>
          </View>
        </If>
        <Tabs style={{ flexDirection: "row", flex: compact() ? 1 : undefined, minWidth: 0, gap: 2, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: spotify() ? token("border") : palette().line, backgroundColor: spotify() ? token("card") : palette().panel }} indicatorStyle={{ top: 3, bottom: 3, borderRadius: 999, backgroundColor: selected() }}>
          <Each of={providers}>{provider => (
            <Tab testID={`provider-${provider().id}`} accessibilityLabel={`切换到 ${provider().label}`} selected={activeProvider() === provider().id}
              disabled={!providersReady() || switchingProvider()}
              onPress={() => void selectProvider(provider().id)}
              style={{ flex: compact() ? 1 : undefined, minWidth: 0, height: 34, paddingHorizontal: compact() ? 12 : 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999 }}
              activeStyle={{ opacity: 0.7 }} class="transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary">
              <Icon name={provider().icon} size={16} color={activeProvider() === provider().id ? provider().color : muted()} />
              <Text style={{ minWidth: 0, flexShrink: 1, fontSize: 13, textAlign: "center", numberOfLines: 1, fontWeight: activeProvider() === provider().id ? "600" : "400", color: activeProvider() === provider().id ? foreground() : muted() }}>{provider().label}</Text>
            </Tab>
          )}</Each>
        </Tabs>
        <If when={!compact()}>
          <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}><Text testID="provider-status" style={{ color: muted(), fontSize: 11, textAlign: "right" }}>{switchingProvider() ? "正在切换…" : "各自的音乐，熟悉的空间"}</Text></View>
        </If>
      </View>
    </View>
  );
}
