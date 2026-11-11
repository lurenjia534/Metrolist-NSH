// A separate host runtime can keep auth.login pending while the app verifies its session.
export function createHost(player) {
  let pending;
  let auto;
  const calls = [];
  return {
    call(name, data) {
      calls.push({ name, data });
      player.hostEvent("test.calls", calls);
      if (name === "auth.available") return { available: true, method: "webview" };
      if (name === "auth.logout") return { cleared: true };
      if (name === "app.audio.snapshot" || name === "app.audio.settings") return null;
      if (name === "auth.test.emit") { player.hostEvent(data.event, data.payload); return null; }
      if (name === "auth.test.auto") { auto = data; return null; }
      if (name === "auth.login") {
        const result = new Promise(resolve => { pending = resolve; });
        if (auto) {
          player.hostEvent("auth.progress", { requestId: data.requestId, stage: "waiting", message: "请完成 Google 登录，随后自动返回。" });
          setTimeout(() => { if (pending) player.hostEvent("auth.session", { requestId: data.requestId, attemptId: `auto-${data.requestId}`, credentials: auto.credentials }); }, auto.delay);
        }
        return result;
      }
      if (name === "auth.complete") {
        const accepted = !!pending;
        if (accepted && data.ok) {
          const finish = pending;
          pending = undefined;
          finish({ completed: true, attemptId: data.attemptId });
        }
        return { accepted };
      }
      if (name === "auth.test.cancel") {
        const finish = pending;
        pending = undefined;
        finish({ cancelled: true });
        return null;
      }
      throw new Error(`Unexpected test host call: ${name}`);
    },
  };
}
