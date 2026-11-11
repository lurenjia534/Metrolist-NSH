import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { nsh, nshEnv } from "./nsh-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".nsh/web-package");
const build = spawnSync(nsh, ["package", root, "--target", "web", "-o", output], { env: nshEnv, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status || 1);

const packageName = JSON.parse(readFileSync(join(root, "nsh.json"), "utf8")).name;
const client = join(root, "dist/client");
rmSync(client, { recursive: true, force: true });
mkdirSync(join(root, "dist/server"), { recursive: true });
cpSync(join(output, packageName), client, { recursive: true });
cpSync(join(root, "web/sw.js"), join(client, "sw.js"));

let html = readFileSync(join(client, "index.html"), "utf8");
html = html.replace('<html lang="en">', '<html lang="zh-CN">');
html = html.replace("<title>Metrolist</title>", '<title>Metrolist NSH</title>\n<meta name="description" content="用 Native Shell 编写的跨平台音乐客户端。探索 YouTube Music、建立歌单、收藏与聆听。">\n<meta name="referrer" content="strict-origin-when-cross-origin">');
html = html.replace("</style>", "html,body{background:#0e0d12;color:#e9e6f2} #status .spinner{border-top-color:#c7c3f5}\n</style>");
writeFileSync(join(client, "index.html"), html);
writeFileSync(join(client, "index.html.gz"), gzipSync(html));
writeFileSync(join(client, "index.html.br"), brotliCompressSync(html));
const manifest = JSON.parse(readFileSync(join(client, "manifest.webmanifest"), "utf8"));
Object.assign(manifest, { name: "Metrolist · NSH", short_name: "Metrolist", lang: "zh-CN", theme_color: "#0e0d12", background_color: "#0e0d12", description: "Metrolist NSH 音乐播放器", display: "standalone" });
writeFileSync(join(client, "manifest.webmanifest"), JSON.stringify(manifest));

// The gateway uses only Web-standard APIs and needs no bundler dependency.
const shared = ["auth", "catalog", "streaming", "account", "index"].map(name =>
  readFileSync(join(root, `server/${name}.mjs`), "utf8")
    .replace(/^import .* from '\.\/(?:auth|catalog|streaming|account)\.mjs';\r?\n/gm, "")
    .split("export default {")[0].replace(/^export /gm, "")
).join("\n");
const worker = `${shared}\nconst INDEX_HTML = ${JSON.stringify(html)};\nexport default { async fetch(request, env, ctx) {\n const path = new URL(request.url).pathname;\n if (path.startsWith('/api/')) return api(request, env);\n if (path === '/' || path === '/index.html') return new Response(INDEX_HTML, {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Referrer-Policy':'strict-origin-when-cross-origin'}});\n return env.ASSETS.fetch(request);\n}};\n`;
writeFileSync(join(root, "dist/server/index.js"), worker);
// Local hosting configuration is optional; the public checkout builds on its own.
const hosting = join(root, ".openai/hosting.json");
rmSync(join(root, "dist/.openai"), { recursive: true, force: true });
if (existsSync(hosting)) {
  mkdirSync(join(root, "dist/.openai"), { recursive: true });
  cpSync(hosting, join(root, "dist/.openai/hosting.json"));
}
console.log(`Metrolist built: ${readdirSync(client).length} assets + music gateway`);
