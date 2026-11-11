import { expect, open, test } from "nsh/test";

for (const reducedMotion of [false, true]) test(`notifications can update during exit and show the same message after dismissal, reduced motion ${reducedMotion}`, async () => {
  const app = await open("./toast-fixture.tsx", { width: 360, height: 740, platform: "web", reducedMotion, clock: {} });
  await app.press("id:show-first"); await app.waitFor("id:toast");
  expect(app.texts()).toContain("First message");
  await app.press("id:clear-message");
  await app.press("id:show-second"); await app.waitFor("id:toast");
  expect(app.texts()).toContain("Second message");
  expect(app.texts().includes("First message")).toBe(false);

  await app.clock!.fastForward(4000);
  await app.waitFor("id:toast", { state: "gone" });
  await app.press("id:show-second"); await app.waitFor("id:toast");
  expect(app.texts()).toContain("Second message");
  await app.drag("id:toast", { x: 100 });
  await app.waitFor("id:toast", { state: "gone" });
  await app.press("id:show-second"); await app.waitFor("id:toast");
  expect(app.texts()).toContain("Second message");
});
