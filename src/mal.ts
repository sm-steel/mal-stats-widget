// MyAnimeList data for the stats card: the user's whole anime list via the official
// v2 API (Client-ID auth only), stats computed from it, and poster thumbnails.

export interface Entry {
	node: {
		title?: string;
		main_picture?: { medium?: string };
		average_episode_duration?: number;
	};
	list_status?: {
		status?: string;
		score?: number;
		num_episodes_watched?: number;
		updated_at?: string;
	};
}

export type Reason =
	| "no client id"
	| "no username"
	| "timeout"
	| "bad response"
	| `mal ${number}`;

export class MalError extends Error {
	constructor(readonly reason: Reason) {
		super(reason);
		this.name = "MalError";
	}
}

const API = "https://api.myanimelist.net/v2/";
const CDN = "https://cdn.myanimelist.net/";

const isTimeout = (e: unknown) =>
	e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

export async function fetchAnimeList(
	username: string | undefined,
	clientId: string | undefined,
	fetchFn: typeof fetch = fetch,
	opts: {
		pageTimeoutMs?: number;
		totalTimeoutMs?: number;
		maxPages?: number;
	} = {},
): Promise<Entry[]> {
	const { pageTimeoutMs = 6000, totalTimeoutMs = 18000, maxPages = 10 } = opts;
	if (!clientId) throw new MalError("no client id");
	if (!username) throw new MalError("no username");
	const overall = AbortSignal.timeout(totalTimeoutMs);
	const entries: Entry[] = [];
	let url: string | undefined =
		`${API}users/${encodeURIComponent(username)}/animelist?fields=list_status,average_episode_duration&limit=1000`;
	for (let page = 0; url && page < maxPages; page++) {
		if (!url.startsWith(API)) throw new MalError("bad response");
		let body: { data?: unknown; paging?: { next?: unknown } };
		try {
			const res = await fetchFn(url, {
				headers: { "X-MAL-Client-ID": clientId },
				signal: AbortSignal.any([overall, AbortSignal.timeout(pageTimeoutMs)]),
			});
			if (!res.ok) throw new MalError(`mal ${res.status}`);
			body = await res.json();
		} catch (e) {
			if (e instanceof MalError) throw e;
			throw new MalError(isTimeout(e) ? "timeout" : "bad response");
		}
		if (!Array.isArray(body?.data)) throw new MalError("bad response");
		entries.push(...(body.data as Entry[]));
		const next = body.paging?.next;
		url = typeof next === "string" ? next : undefined;
	}
	return entries;
}

export interface Stats {
	total: number;
	completed: number;
	watching: number;
	meanScore: number;
	daysWatched: number;
}

export function computeStats(entries: Entry[]): Stats {
	const count = (s: string) =>
		entries.filter((e) => e.list_status?.status === s).length;
	const scores = entries
		.map((e) => e.list_status?.score ?? 0)
		.filter((s) => s > 0);
	const seconds = entries.reduce(
		(sum, e) =>
			sum +
			(e.list_status?.num_episodes_watched ?? 0) *
				(e.node.average_episode_duration ?? 0),
		0,
	);
	return {
		total: entries.length,
		completed: count("completed"),
		watching: count("watching"),
		meanScore: scores.length
			? scores.reduce((a, b) => a + b, 0) / scores.length
			: 0,
		daysWatched: seconds / 86400,
	};
}

/** Most recently updated entries, excluding plan-to-watch. */
export function recentEntries(entries: Entry[], count = 6): Entry[] {
	return entries
		.filter((e) => e.list_status?.status !== "plan_to_watch")
		.sort((a, b) =>
			(b.list_status?.updated_at ?? "").localeCompare(
				a.list_status?.updated_at ?? "",
			),
		)
		.slice(0, count);
}

/** The CDN's 116×180 resize of a poster (≈7.6 KB instead of ≈57 KB); other hosts unchanged. */
export function posterUrl(medium: string | undefined): string | undefined {
	if (!medium) return undefined;
	return medium.startsWith(CDN) && !medium.startsWith(`${CDN}r/`)
		? `${CDN}r/116x180/${medium.slice(CDN.length)}`
		: medium;
}

const IMAGE_TYPES: Record<string, string> = {
	"image/jpeg": "image/jpeg",
	"image/jpg": "image/jpeg",
	"image/png": "image/png",
	"image/webp": "image/webp",
};

/** Each entry's poster as a data URI, or undefined when missing or the download fails. */
export function fetchPosters(
	entries: Entry[],
	fetchFn: typeof fetch = fetch,
	timeoutMs = 4000,
): Promise<(string | undefined)[]> {
	return Promise.all(
		entries.map(async (e) => {
			const url = posterUrl(e.node.main_picture?.medium);
			if (!url) return undefined;
			try {
				const res = await fetchFn(url, {
					signal: AbortSignal.timeout(timeoutMs),
				});
				const type =
					IMAGE_TYPES[
						(res.headers.get("content-type") ?? "")
							.split(";")[0]
							?.trim()
							.toLowerCase() ?? ""
					];
				if (!res.ok || !type) return undefined;
				return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
			} catch {
				return undefined;
			}
		}),
	);
}
