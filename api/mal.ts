// GET /api/mal?theme=dark|light — MyAnimeList anime stats as a neon card.
import { FLAVORS } from "@sm-steel/neon-kit";
import {
	computeStats,
	fetchAnimeList,
	fetchPosters,
	MalError,
	recentEntries,
} from "../src/mal.js";
import { renderFallback, renderStats } from "../src/render.js";

export const CACHE_OK =
	"public, max-age=0, s-maxage=1800, stale-while-revalidate=3600";
export const CACHE_FAIL = "no-store";

export interface Deps {
	fetchFn: typeof fetch;
	env: Record<string, string | undefined>;
	now: () => Date;
}

const svg = (body: string, cache: string) =>
	new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "image/svg+xml; charset=utf-8",
			"Cache-Control": cache,
		},
	});

export async function handle(
	request: Request,
	deps: Partial<Deps> = {},
): Promise<Response> {
	const { fetchFn = fetch, env = process.env, now = () => new Date() } = deps;
	const p =
		new URL(request.url).searchParams.get("theme") === "light"
			? FLAVORS.latte
			: FLAVORS.mocha;
	try {
		const entries = await fetchAnimeList(
			env.MAL_USERNAME,
			env.MAL_CLIENT_ID,
			fetchFn,
		);
		const recent = recentEntries(entries);
		const posters = await fetchPosters(recent, fetchFn);
		return svg(
			renderStats(computeStats(entries), recent, posters, p, now()),
			CACHE_OK,
		);
	} catch (e) {
		// only our own reason strings reach the card, never raw error text
		const reason = e instanceof MalError ? e.reason : "bad response";
		return svg(renderFallback(reason, p), CACHE_FAIL);
	}
}

export function GET(request: Request): Promise<Response> {
	return handle(request);
}
