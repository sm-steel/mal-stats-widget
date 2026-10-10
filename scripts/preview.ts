// Local preview: renders the real card (env from --env-file FILE, KEY=VALUE lines, as
// written by `vercel env pull`) and a fallback card, on GitHub's dark/light backgrounds.
//   npx tsx scripts/preview.ts --env-file FILE [--serve]   → http://127.0.0.1:8769/
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, sep } from "node:path";
import { handle } from "../api/mal.js";

const OUT = "preview/out";
await mkdir(OUT, { recursive: true });

const at = process.argv.indexOf("--env-file");
const env: Record<string, string> = {};
if (at > 0) {
	for (const line of (
		await readFile(process.argv[at + 1] as string, "utf8")
	).split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
		if (m) env[m[1] as string] = m[2] as string;
	}
}

for (const theme of ["dark", "light"]) {
	const req = new Request(`http://localhost/api/mal?theme=${theme}`);
	await writeFile(
		join(OUT, `mal-${theme}.svg`),
		await (await handle(req, { env })).text(),
	);
	await writeFile(
		join(OUT, `fallback-${theme}.svg`),
		await (await handle(req, { env: {} })).text(),
	);
}
const img = (f: string) =>
	`<img src="${f}" style="width:min(100%,830px);display:block;margin:12px auto">`;
await writeFile(
	join(OUT, "index.html"),
	`<!doctype html><meta charset="utf-8"><title>MAL preview</title><body style="margin:0">` +
		`<div style="background:#0d1117;padding:16px">${img("mal-dark.svg")}${img("fallback-dark.svg")}</div>` +
		`<div style="background:#fff;padding:16px">${img("mal-light.svg")}${img("fallback-light.svg")}</div></body>`,
);
console.log(
	`preview: ${OUT}/index.html${env.MAL_CLIENT_ID ? "" : " (no MAL_CLIENT_ID: real card shows the fallback)"}`,
);

if (process.argv.includes("--serve")) {
	const root = join(OUT);
	createServer((req, res) => {
		let path: string;
		try {
			path = decodeURIComponent((req.url ?? "/").split("?")[0] as string);
		} catch {
			return void res.writeHead(400).end();
		}
		const file = join(root, path === "/" ? "index.html" : path);
		if (!file.startsWith(root + sep)) return void res.writeHead(403).end();
		res.setHeader(
			"Content-Type",
			extname(file) === ".svg" ? "image/svg+xml" : "text/html; charset=utf-8",
		);
		createReadStream(file)
			.on("error", () => res.writeHead(404).end())
			.pipe(res);
	}).listen(8769, "127.0.0.1", () =>
		console.log("serving http://127.0.0.1:8769/"),
	);
}
