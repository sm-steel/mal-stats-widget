import { FLAVORS } from "@sm-steel/neon-kit";
import { describe, expect, it } from "vitest";
import type { Entry, Stats } from "../src/mal.js";
import { LAYOUT, renderFallback, renderStats } from "../src/render.js";

const p = FLAVORS.mocha;
const now = new Date("2026-10-10T12:00:00Z");
const stats: Stats = {
	total: 517,
	completed: 296,
	watching: 33,
	meanScore: 8.42,
	daysWatched: 86.66,
};
const e = (title: string, updated = "2026-09-01T00:00:00Z"): Entry => ({
	node: { title },
	list_status: { status: "completed", updated_at: updated },
});
const six = Array.from({ length: 6 }, (_, i) => e(`Anime ${i}`));
const h = (svg: string) => Number(svg.match(/height="([\d.]+)"/)?.[1]);

describe("renderStats", () => {
	it("shows five tiles with formatted values", () => {
		const svg = renderStats(stats, six, [], p, now);
		for (const v of ["517", "296", "33", "8.4", "86.7"])
			expect(svg).toContain(`>${v}</text>`);
		for (const l of [
			"Total",
			"Completed",
			"Watching",
			"Mean Score",
			"Days Watched",
		])
			expect(svg).toContain(`>${l}</text>`);
		expect(svg).toContain("RECENTLY WATCHED");
	});

	it("wraps long titles to 3 lines with … and puts the date on the next line (Review Focus 2)", () => {
		const long =
			// 2 × 108 chars: well past 3 lines × 43 chars, so it must end with "…"
			"Akuyaku Reijou Level 99: Watashi wa Ura-Boss desu ga Maou dewa Arimasen and then some more words to overflow".repeat(
				2,
			);
		const svg = renderStats(
			stats,
			[e(long, "2026-10-09T12:00:00Z")],
			[],
			p,
			now,
		);
		const lines = [
			...svg.matchAll(
				/<text x="74" y="([\d.]+)" font-size="13"[^>]*>([^<]*)</g,
			),
		];
		expect(lines).toHaveLength(3);
		expect(lines[2]?.[2]?.endsWith("…")).toBe(true);
		const date = svg.match(
			/<text x="74" y="([\d.]+)" font-size="11"[^>]*>yesterday</,
		);
		expect(Number(date?.[1])).toBe(Number(lines[2]?.[1]) + 16);
	});

	it("escapes text and keeps Cyrillic (Review Focus 2)", () => {
		const svg = renderStats(stats, [e(`Rock & <Roll> "Ёж"`)], [], p, now);
		expect(svg).toContain("Rock &amp; &lt;Roll&gt; &quot;Ёж&quot;");
	});

	it("shrinks the grid to the entries, and omits it with none (Review Focus 3)", () => {
		const full = h(renderStats(stats, six, [], p, now));
		const three = h(renderStats(stats, six.slice(0, 3), [], p, now));
		expect(full - three).toBe(LAYOUT.rowH + LAYOUT.rowGap);
		const none = renderStats(stats, [], [], p, now);
		expect(none).not.toContain("RECENTLY WATCHED");
		expect(full - h(none)).toBe(
			LAYOUT.gridTop + 3 * LAYOUT.rowH + 2 * LAYOUT.rowGap - LAYOUT.tileH,
		);
	});

	it("embeds posters with mal- clip ids or a placeholder", () => {
		const svg = renderStats(
			stats,
			six.slice(0, 2),
			["data:image/jpeg;base64,AQID", undefined],
			p,
			now,
		);
		expect(svg).toContain('clip-path="url(#mal-p0)"');
		expect(svg).not.toContain("mal-p1");
		expect(svg).toContain(`rx="2" fill="${p.border}"`);
	});
});

describe("renderFallback", () => {
	it("shows the reason", () => {
		const svg = renderFallback("mal 403", p);
		expect(svg).toContain("SIGNAL LOST");
		expect(svg).toContain("mal 403");
		expect(svg).toContain("ANIME STATS");
	});
});
