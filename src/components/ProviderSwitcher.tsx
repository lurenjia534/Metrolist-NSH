import { Image, Text, View, colorScheme, platform, token, windowSize } from "nsh";
import { Tabs, Tab } from "nsh/base";
import { Icon } from "../icons";
import { palette } from "../ui";
import { activeProvider, providersReady, selectProvider, switchingProvider } from "../providers";
import logo from "../../assets/metrolist-icon.png";

const providers = [
  { id: "youtube", label: "YouTube Music", icon: "play", color: "#ef5268" },
  { id: "spotify", label: "Spotify", icon: "headphones", color: "#1db954" },
] as const;

/** A service rail preserves the page's height on a phone in landscape. */
export const providerRail = () =>
  (platform.os === "android" || platform.os === "ios") && windowSize().height < 480 && windowSize().width > windowSize().height;

export function ProviderSwitcher() {
  const compact = () => windowSize().width < 900;
  const spotify = () => activeProvider() === "spotify";
  const background = () => spotify() ? token("sidebar") : palette().panel;
  const foreground = () => spotify() ? token("foreground") : palette().text;
  const muted = () => spotify() ? token("muted-foreground") : palette().sub;
  const selected = () => spotify() ? token("sidebar-accent") : palette().selected;
  return (
    <View testID="provider-switcher" style={{
      flexShrink: 0, backgroundColor: background(),
      borderBottomWidth: providerRail() ? 0 : 1, borderRightWidth: providerRail() ? 1 : 0,
      borderColor: spotify() ? token("sidebar-border") : palette().line,
      paddingTop: platform.os === "android" || platform.os === "ios" ? "env(safe-area-inset-top)" : 0,
      paddingBottom: providerRail() ? "env(safe-area-inset-bottom)" : 0,
      paddingLeft: "env(safe-area-inset-left)", paddingRight: providerRail() ? 0 : "env(safe-area-inset-right)",
    }}>
      <View style={{ width: providerRail() ? 108 : undefined, flex: providerRail() ? 1 : undefined, minHeight: 56, minWidth: 0, flexDirection: providerRail() ? "column" : "row", alignItems: providerRail() ? "stretch" : "center", gap: providerRail() ? 14 : 20, paddingHorizontal: providerRail() ? 8 : compact() ? 12 : 24, paddingVertical: providerRail() ? 12 : 6 }}>
        <If when={providerRail() || !compact()}>
          <View style={{ flexDirection: providerRail() ? "column" : "row", alignItems: "center", gap: providerRail() ? 6 : 9, width: providerRail() ? undefined : 168 }}>
            <Image src={logo} style={{ width: 26, height: 26, borderRadius: 8 }} />
            <Text style={{ color: foreground(), fontSize: providerRail() ? 11 : 14, fontWeight: "600" }}>Metrolist</Text>
          </View>
        </If>
        <Tabs style={{ flexDirection: providerRail() ? "column" : "row", flex: !providerRail() && compact() ? 1 : undefined, minWidth: 0, gap: 4, padding: 3, borderRadius: 16, backgroundColor: colorScheme() === "dark" ? "#ffffff08" : "#00000006" }} indicatorStyle={{ left: providerRail() ? 3 : undefined, right: providerRail() ? 3 : undefined, top: providerRail() ? undefined : 3, bottom: providerRail() ? undefined : 3, borderRadius: 13, backgroundColor: selected() }}>
          <Each of={providers}>{provider => (
            <Tab testID={`provider-${provider().id}`} accessibilityLabel={`切换到 ${provider().label}`} selected={activeProvider() === provider().id}
              disabled={!providersReady() || switchingProvider()}
              onPress={() => void selectProvider(provider().id)}
              style={{ flex: !providerRail() && compact() ? 1 : undefined, minWidth: 0, height: providerRail() ? 76 : 38, paddingHorizontal: providerRail() ? 4 : compact() ? 12 : 20, flexDirection: providerRail() ? "column" : "row", alignItems: "center", justifyContent: "center", gap: providerRail() ? 6 : 9, borderRadius: 13 }}
              activeStyle={{ opacity: 0.7 }} class="transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary">
              <Icon name={provider().icon} size={providerRail() ? 22 : 17} color={activeProvider() === provider().id ? provider().color : muted()} />
              <Text style={{ minWidth: 0, flexShrink: 1, fontSize: providerRail() ? 12 : 13, textAlign: "center", numberOfLines: providerRail() ? 2 : 1, fontWeight: activeProvider() === provider().id ? "600" : "400", color: activeProvider() === provider().id ? foreground() : muted() }}>{providerRail() && provider().id === "youtube" ? "YouTube\nMusic" : provider().label}</Text>
            </Tab>
          )}</Each>
        </Tabs>
        <If when={providerRail() || !compact()}>
          <View style={{ flex: 1, minWidth: 0, justifyContent: providerRail() ? "flex-end" : "center" }}><Text testID="provider-status" style={{ color: muted(), fontSize: 11, textAlign: providerRail() ? "center" : "right" }}>{switchingProvider() ? "正在切换…" : providerRail() ? "切换服务" : "各自的音乐，熟悉的空间"}</Text></View>
        </If>
      </View>
    </View>
  );
}
