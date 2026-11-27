/**
 * Minimal Chrome DevTools Protocol driver for visual checks.
 *   bun scripts/screenshot.ts <out-prefix> <steps.json>
 * Needs a headless Chromium-family browser listening on :9333 (see CLAUDE.md).
 * Steps (run in order, each object may combine keys):
 *   {"go": url} {"wait": ms} {"eval": js} {"click": [x,y]} {"move": [x,y]}
 *   {"drag": [x0,y0,x1,y1], "shift"?: true} {"wheel": [x,y,deltaY]}
 *   {"shot": name, "clip"?: {x,y,width,height}}  -> <out-prefix>-<name>.png
 * Prints eval results, then any console errors/warnings and exceptions.
 */
const [outPrefix, stepsJson] = process.argv.slice(2);
const steps: any[] = JSON.parse(await Bun.file(stepsJson!).text());
const targets = await (await fetch("http://localhost:9333/json")).json();
let page = targets.find((t: any) => t.type === "page");
if (!page) page = await (await fetch("http://localhost:9333/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const logs: string[] = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 400));
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) logs.push(msg.params.type + " " + msg.params.args.map((a: any) => a.value ?? a.description).join(" ").slice(0, 300));
};
const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
let n = 0;
for (const s of steps) {
  if (s.go) { await send("Page.navigate", { url: s.go }); }
  if (s.wait) await Bun.sleep(s.wait);
  if (s.eval) { const r = await send("Runtime.evaluate", { expression: s.eval, returnByValue: true, awaitPromise: true }); console.log("eval:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text)); }
  if (s.click) { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: s.click[0], y: s.click[1], button: "left", clickCount: 1 }); }
  if (s.move) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.move[0], y: s.move[1] });
  if (s.drag) { const [x0, y0, x1, y1] = s.drag; await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1, modifiers: s.shift ? 8 : 0 });
    for (let k = 1; k <= 8; k++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * k) / 8, y: y0 + ((y1 - y0) * k) / 8, button: "left", buttons: 1, modifiers: s.shift ? 8 : 0 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1, modifiers: s.shift ? 8 : 0 }); }
  if (s.wheel) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: s.wheel[0], y: s.wheel[1], deltaX: 0, deltaY: s.wheel[2] });
  if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png", ...(s.clip ? { clip: { ...s.clip, scale: 1 } } : {}) }); const f = `${outPrefix}-${s.shot}.png`; await Bun.write(f, Buffer.from(r.result.data, "base64")); console.log("shot", f); }
}
console.log(logs.length ? logs.join("\n") : "no console errors");
ws.close();
process.exit(0);
