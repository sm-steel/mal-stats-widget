import { describe, expect, it, vi } from "vitest";
import {
	computeStats,
	type Entry,
	fetchAnimeList,
	fetchPosters,
	posterUrl,
	recentEntries,
} from "../src/mal.js";

const BASE = "https://api.myanimelist.net/v2/";
const entry = (
	status: string,
	o: Partial<NonNullable<Entry["list_status"]>> = {},
	n: Partial<Entry["node"]> = {},
): Entry => ({
	node: { title: `T-${status}`, average_episode_duration: 1440, ...n },
	list_status: { status, score: 0, num_episodes_watched: 0, ...o },
});
const page = (data: Entry[], next?: string) =>
	new Response(JSON.stringify({ data, paging: next ? { next } : {} }), {
		headers: { "content-type": "application/json" },
	});

describe("fetchAnimeList", () => {
	it("follows pagination with the client id header and an encoded username (Review Focus 5)", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				page([entry("completed")], `${BASE}users/x/animelist?offset=1000`),
			)
			.mockResolvedValueOnce(page([entry("watching")]));
		const list = await fetchAnimeList("a b/c", "cid", fetchFn);
		expect(list).toHaveLength(2);
		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			`${BASE}users/a%20b%2Fc/animelist?fields=list_status,average_episode_duration&limit=1000`,
		);
		expect((init.headers as Record<string, string>)["X-MAL-Client-ID"]).toBe(
			"cid",
		);
		expect(fetchFn.mock.calls[1]?.[0]).toBe(
			`${BASE}users/x/animelist?offset=1000`,
		);
	});

	it("refuses off-API pagination and stops at the page cap (Review Focus 4)", async () => {
		const evil = vi
			.fn()
			.mockResolvedValueOnce(
				page([entry("completed")], "https://evil.example/next"),
			);
		await expect(fetchAnimeList("u", "c", evil)).rejects.toMatchObject({
			reason: "bad response",
		});
		expect(evil).toHaveBeenCalledTimes(1);
		const endless = vi.fn(async () =>
			page([entry("completed")], `${BASE}users/u/animelist?more`),
		);
		const list = await fetchAnimeList("u", "c", endless, { maxPages: 3 });
		expect(endless).toHaveBeenCalledTimes(3);
		expect(list).toHaveLength(3);
	});

	it("maps failures to reasons", async () => {
		await expect(fetchAnimeList("u", undefined, vi.fn())).rejects.toMatchObject(
			{ reason: "no client id" },
		);
		await expect(fetchAnimeList(undefined, "c", vi.fn())).rejects.toMatchObject(
			{ reason: "no username" },
		);
		const forbidden = vi.fn(async () => new Response("{}", { status: 403 }));
		await expect(fetchAnimeList("u", "c", forbidden)).rejects.toMatchObject({
			reason: "mal 403",
		});
		const html = vi.fn(async () => new Response("<html>"));
		await expect(fetchAnimeList("u", "c", html)).rejects.toMatchObject({
			reason: "bad response",
		});
		const noData = vi.fn(async () => new Response("{}"));
		await expect(fetchAnimeList("u", "c", noData)).rejects.toMatchObject({
			reason: "bad response",
		});
		const slow = vi.fn(async () => {
			throw Object.assign(new Error("t"), { name: "TimeoutError" });
		});
		await expect(fetchAnimeList("u", "c", slow)).rejects.toMatchObject({
			reason: "timeout",
		});
	});
});

describe("computeStats", () => {
	it("counts statuses, averages scored entries only and sums watch time", () => {
		const s = computeStats([
			entry("completed", { score: 8, num_episodes_watched: 12 }),
			entry("completed", { score: 9, num_episodes_watched: 24 }),
			entry("watching", { score: 0, num_episodes_watched: 3 }),
			entry("plan_to_watch"),
		]);
		expect(s).toEqual({
			total: 4,
			completed: 2,
			watching: 1,
			meanScore: 8.5,
			daysWatched: ((12 + 24 + 3) * 1440) / 86400,
		});
	});
	it("tolerates missing fields (Review Focus 1)", () => {
		const s = computeStats([
			{ node: {} },
			entry("dropped", {}, { average_episode_duration: undefined }),
		]);
		expect(s).toMatchObject({ total: 2, meanScore: 0, daysWatched: 0 });
	});
});

describe("recentEntries", () => {
	it("skips plan-to-watch, sorts newest first and takes 6", () => {
		const list = [
			entry("plan_to_watch", { updated_at: "2026-10-09T00:00:00Z" }),
			...Array.from({ length: 7 }, (_, i) =>
				entry(
					"completed",
					{ updated_at: `2026-10-0${i + 1}T00:00:00Z` },
					{ title: `t${i + 1}` },
				),
			),
			entry("watching", {}, { title: "undated" }),
		];
		expect(recentEntries(list).map((e) => e.node.title)).toEqual([
			"t7",
			"t6",
			"t5",
			"t4",
			"t3",
			"t2",
		]);
	});
});

describe("posters", () => {
	it("rewrites CDN posters to the 116x180 thumbnail", () => {
		expect(
			posterUrl("https://cdn.myanimelist.net/images/anime/1015/138006.jpg"),
		).toBe(
			"https://cdn.myanimelist.net/r/116x180/images/anime/1015/138006.jpg",
		);
		expect(posterUrl("https://other.example/x.jpg")).toBe(
			"https://other.example/x.jpg",
		);
		expect(posterUrl(undefined)).toBeUndefined();
	});

	it("embeds images, normalizes image/jpg and leaves failures empty (Review Focus 1)", async () => {
		const entries = [
			entry(
				"completed",
				{},
				{
					main_picture: { medium: "https://cdn.myanimelist.net/images/a.jpg" },
				},
			),
			entry(
				"completed",
				{},
				{
					main_picture: { medium: "https://cdn.myanimelist.net/images/b.jpg" },
				},
			),
			entry(
				"completed",
				{},
				{
					main_picture: { medium: "https://cdn.myanimelist.net/images/c.jpg" },
				},
			),
			entry("completed"),
		];
		const fetchFn = vi.fn(async (url: string | URL | Request) => {
			const u = String(url);
			if (u.endsWith("a.jpg"))
				return new Response(new Uint8Array([1, 2, 3]), {
					headers: { "content-type": "image/jpg" },
				});
			if (u.endsWith("b.jpg"))
				return new Response("<html>", {
					headers: { "content-type": "text/html" },
				});
			throw new Error("down");
		});
		const posters = await fetchPosters(entries, fetchFn);
		expect(posters).toEqual([
			"data:image/jpeg;base64,AQID",
			undefined,
			undefined,
			undefined,
		]);
		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/r/116x180/");
	});
});
