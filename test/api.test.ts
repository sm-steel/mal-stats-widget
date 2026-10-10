import { describe, expect, it, vi } from "vitest";
import { CACHE_FAIL, CACHE_OK, handle } from "../api/mal.js";

const data = [
	{
		node: { title: "Sousou no Frieren", average_episode_duration: 1440 },
		list_status: {
			status: "completed",
			score: 10,
			num_episodes_watched: 28,
			updated_at: "2026-09-01T00:00:00Z",
		},
	},
];
const fetchFn = vi.fn(
	async () => new Response(JSON.stringify({ data, paging: {} })),
) as unknown as typeof fetch;
const env = { MAL_CLIENT_ID: "cid-secret", MAL_USERNAME: "u" };
const now = () => new Date("2026-10-10T12:00:00Z");
const req = (q = "") => new Request(`https://example.vercel.app/api/mal${q}`);

describe("handle", () => {
	it("returns the card as cacheable SVG", async () => {
		const res = await handle(req(), { fetchFn, env, now });
		expect(res.headers.get("content-type")).toBe(
			"image/svg+xml; charset=utf-8",
		);
		expect(res.headers.get("cache-control")).toBe(CACHE_OK);
		const svg = await res.text();
		expect(svg).toContain("Sousou no Frieren");
		expect(svg).toContain("#11111b");
		expect(svg).not.toContain("cid-secret");
	});
	it("switches to Latte for theme=light only", async () => {
		expect(
			await (await handle(req("?theme=light"), { fetchFn, env, now })).text(),
		).toContain("#eff1f5");
		expect(
			await (await handle(req("?theme=x"), { fetchFn, env, now })).text(),
		).toContain("#11111b");
	});
	it("serves an uncached fallback without leaking error text", async () => {
		const boom = vi.fn(async () => {
			throw new Error("secret-ish");
		}) as unknown as typeof fetch;
		const res = await handle(req(), { fetchFn: boom, env, now });
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(CACHE_FAIL);
		const svg = await res.text();
		expect(svg).toContain("bad response");
		expect(svg).not.toContain("secret-ish");
		expect(
			await (await handle(req(), { fetchFn, env: {}, now })).text(),
		).toContain("no client id");
	});
});
