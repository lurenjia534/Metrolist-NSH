import { Overlay, cleanup, computed, effect, reduceMotion, safeArea, signal } from "nsh";
import { Toast, ToastManager, ToastStack, type ToastEntry } from "nsh/base";
import { fullPlayer } from "../navigation";
import { currentTrack } from "../playback";
import { Label, narrow, palette, toast } from "../ui";
import { motion, transition } from "../motion";

/** One retained native toast stack; clearing the message starts its exit. */
export function ToastHost() {
  const timings = { duration: motion.fast, exitDuration: motion.exit, collapsedVisible: 1 };
  const manager = new ToastManager(timings);
  const shown = signal<ToastEntry[]>([]);
  const expanded = signal(false);
  const mounted = computed(() => shown().length > 0);
  const sync = () => shown.set(manager.visible(1));

  effect(() => {
    const message = toast();
    if (message) manager.push("message", message);
    else manager.dismiss("message");
    sync();
  });
  // NSH's documented lifecycle clock; motion itself runs on the UI thread.
  effect(() => {
    if (!mounted()) return;
    const timer = setInterval(() => {
      if (manager.advance(expanded()).changed) sync();
    }, 50);
    return () => clearInterval(timer);
  });
  cleanup(() => manager.dispose());

  const dismiss = () => toast.set("");
  const bottom = () => safeArea().bottom + (fullPlayer() ? 80 : currentTrack() ? narrow() ? 156 : 100 : narrow() ? 84 : 24);

  return <Overlay testID="toast-host" style={{ pointerEvents: "box-none", left: 16, right: 16, bottom: bottom(), alignItems: narrow() ? "center" : "flex-end", minWidth: 0 }}>
    <ToastStack placement={narrow() ? "bottomCenter" : "bottomRight"} motion={timings} style={{ width: "100%", maxWidth: 360, minWidth: 0 }} onExpandedChange={({ expanded: value }) => expanded.set(value)} onCancel={dismiss}>
      <Each of={shown()} key={entry => entry.id}>{entry =>
        <Toast testID="toast" transitionStatus={entry().status} accessibilityLabel={entry().value as string} onDismissRequest={dismiss}
          startingClass={reduceMotion() ? "" : "opacity-0 translate-y-8 scale-90"}
          endingClass={reduceMotion() ? "opacity-0" : "opacity-0 translate-x-12 scale-95"} swipingClass="transition-none" swipeDirection="right"
          class="flex-row items-center gap-3 rounded-(--radius-card) border border-border bg-popover px-4 py-3 shadow-xl transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ minWidth: 0 }}>
          <Label size={14} color={palette().text} weight="500">{entry().value as string}</Label>
        </Toast>
      }</Each>
    </ToastStack>
  </Overlay>;
}
