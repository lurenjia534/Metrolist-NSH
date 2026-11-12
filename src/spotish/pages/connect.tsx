import { Clipboard, platform, Scroll, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { errorOf } from "../backend/types";
import { connectedBackend } from "../state/engine";
import { connectionOpen, health, retry, signIn } from "../state/session";
import { openExternal } from "../state/links";
import { announce } from "../state/feedback";
import { ActionButton, IconButton, TextLink } from "../components/ui/controls";
import { AppDialog } from "../components/ui/overlays";
import { Logo } from "../ui/logo";

function ConnectionForm() {
  const connection = connectedBackend!;
  const clientId = signal(connection.configuration().clientId);
  const busy = signal(false);
  const error = signal("");
  async function connect() {
    busy.set(true);
    error.set("");
    try {
      await connection.configure(clientId());
      connectionOpen.set(false);
      await connection.signIn();
    } catch (reason) {
      error.set(errorOf(reason).message);
      announce(errorOf(reason).message);
    } finally { busy.set(false); }
  }
  return (
    <View testID="spotify-connection-form" class="gap-4">
      <Text class="text-sm text-muted-foreground">
        填入你的 Spotify 应用 Client ID，并在该应用设置中添加下面的 Redirect URI。登录后会加载你的真实曲库。
      </Text>
      <View class="gap-2">
        <Text class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client ID</Text>
        <Input
          testID="spotify-client-id"
          value={clientId()}
          onChange={({ value }) => clientId.set(value)}
          placeholder="Spotify Developer Dashboard 中的 Client ID"
          accessibilityLabel="Spotify Client ID"
          autoCapitalize="none"
          autoCorrect={false}
          class="min-h-12 rounded-xl border border-border bg-secondary px-4 text-sm text-foreground"
          style={{ placeholderColor: token("muted-foreground"), caretColor: token("foreground") }}
        />
      </View>
      <View class="gap-2 rounded-xl border border-border p-4" selectable>
        <Text class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Redirect URI</Text>
        <Text testID="spotify-redirect-uri" class="text-sm text-foreground">{connection.configuration().redirectUri}</Text>
        <View class="flex-row flex-wrap gap-4">
          <TextLink label="复制回调地址" onPress={() => void Clipboard.writeText(connection.configuration().redirectUri).then(() => announce("回调地址已复制"))} />
          <TextLink label="打开 Spotify 应用设置" onPress={() => openExternal("https://developer.spotify.com/dashboard")} />
        </View>
      </View>
      <If when={error()}><Text role="alert" class="text-sm text-destructive">{error()}</Text></If>
      <ActionButton label={busy() ? "正在连接…" : "保存并登录 Spotify"} variant="primary" disabled={busy() || !clientId().trim()} onPress={() => void connect()} />
    </View>
  );
}

/** The signed-out home is an actual account connection, with no sample library. */
export function SpotifyConnectionPage() {
  const configured = () => connectedBackend!.configuration().configured;
  return (
    <Scroll class="flex-1" contentClass="px-5 py-8 pb-36">
      <View testID="spotify-connect" class="mx-auto w-full max-w-xl gap-6 rounded-3xl border border-border bg-card p-6">
        <Logo size={52} />
        <View class="gap-3">
          <Text role="header" class="text-3xl font-extrabold text-foreground">你的 Spotify，独立的音乐空间。</Text>
          <Text class="text-base text-muted-foreground">
            {platform.os === "web" ? "在这个浏览器中播放，保留完整的 NSH 界面、歌词和动态效果。浏览器播放需要 Spotify Premium。" : "连接手机上的 Spotify，使用这里的曲库、搜索、歌词和动态播放界面。请先安装并登录 Spotify。"}
          </Text>
        </View>
        <If when={health().error && health().error?.code !== "E_CONFIG"}>
          <View role="alert" class="gap-2 rounded-xl bg-secondary p-4">
            <Text class="text-sm text-foreground">{health().error?.message}</Text>
            <TextLink label="重新连接" onPress={retry} />
          </View>
        </If>
        <If when={configured()} else={<ConnectionForm />}>
          <View class="gap-4">
            <ActionButton label="登录 Spotify" variant="primary" onPress={signIn} />
            <TextLink label="修改连接设置" onPress={() => connectionOpen.set(true)} />
          </View>
        </If>
      </View>
    </Scroll>
  );
}

export function SpotifyConnectionDialog() {
  return (
    <AppDialog open={connectionOpen()} onOpenChange={(open) => connectionOpen.set(open)} testID="spotify-connection-dialog">
      <View class="flex-row items-center justify-between px-6 pt-4">
        <Text role="header" class="text-xl font-bold text-foreground">Spotify 连接设置</Text>
        <IconButton name="close" label="关闭连接设置" onPress={() => connectionOpen.set(false)} />
      </View>
      <Scroll class="max-h-140" contentClass="gap-4 p-6"><ConnectionForm /></Scroll>
    </AppDialog>
  );
}
