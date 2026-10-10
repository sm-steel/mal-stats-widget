import {
	type CardOptions,
	card,
	charsPerLine,
	esc,
	FONT_STACK,
	type Palette,
	r3,
	wrapLines,
} from "@sm-steel/neon-kit";
import type { Entry, Stats } from "./mal.js";
import { relativeTime } from "./time.js";

export const LAYOUT = {
	width: 868,
	tileGap: 10,
	tileH: 64,
	subY: 94,
	gridTop: 108,
	colGap: 24,
	rowH: 84,
	rowGap: 12,
	posterW: 60,
	posterH: 84,
	textDx: 74,
	textW: 348,
} as const;

const FONT: CardOptions["font"] = { variant: "text", weights: [400, 700] };
const TITLE_CHARS = charsPerLine(LAYOUT.textW, 13);
const COL_W = (LAYOUT.width - LAYOUT.colGap) / 2;
const TILE_W = (LAYOUT.width - 4 * LAYOUT.tileGap) / 5;

function tiles(s: Stats, p: Palette): string {
	const values: [string, string][] = [
		[String(s.total), "Total"],
		[String(s.completed), "Completed"],
		[String(s.watching), "Watching"],
		[s.meanScore.toFixed(1), "Mean Score"],
		[s.daysWatched.toFixed(1), "Days Watched"],
	];
	return values
		.map(([v, label], i) => {
			const x = r3(i * (TILE_W + LAYOUT.tileGap));
			const cx = r3(x + TILE_W / 2);
			return (
				`<rect x="${x}" y="0" width="${r3(TILE_W)}" height="${LAYOUT.tileH}" rx="2" fill="none" stroke="${p.border}"/>` +
				`<text x="${cx}" y="32" text-anchor="middle" font-size="26" font-weight="700" fill="${p.accent}">${v}</text>` +
				`<text x="${cx}" y="52" text-anchor="middle" font-size="13" fill="${p.text}">${label}</text>`
			);
		})
		.join("");
}

function poster(
	i: number,
	href: string | undefined,
	x: number,
	y: number,
	p: Palette,
): string {
	const box = `x="${x}" y="${y}" width="${LAYOUT.posterW}" height="${LAYOUT.posterH}"`;
	if (!href) return `<rect ${box} rx="2" fill="${p.border}"/>`;
	return (
		`<clipPath id="mal-p${i}"><rect ${box} rx="2"/></clipPath>` +
		`<image ${box} href="${href}" clip-path="url(#mal-p${i})" preserveAspectRatio="xMidYMid slice"/>` +
		`<rect ${box} rx="2" fill="none" stroke="${p.border}"/>`
	);
}

function grid(
	recent: Entry[],
	posters: (string | undefined)[],
	p: Palette,
	now: Date,
): string {
	const header =
		`<text x="0" y="${LAYOUT.subY}" font-size="10" letter-spacing="1.2" fill="${p.text}">` +
		`<tspan fill="${p.accent}">//</tspan> RECENTLY WATCHED</text>`;
	const cells = recent
		.map((e, i) => {
			const x = r3((i % 2) * (COL_W + LAYOUT.colGap));
			const y =
				LAYOUT.gridTop + Math.floor(i / 2) * (LAYOUT.rowH + LAYOUT.rowGap);
			const tx = r3(x + LAYOUT.textDx);
			const lines = wrapLines(e.node.title ?? "", TITLE_CHARS, 3);
			const title = lines
				.map(
					(l, k) =>
						`<text x="${tx}" y="${y + 13 + k * 16}" font-size="13" fill="${p.text}">${esc(l)}</text>`,
				)
				.join("");
			const date = `<text x="${tx}" y="${y + 13 + lines.length * 16}" font-size="11" fill="${p.subtext}">${esc(relativeTime(e.list_status?.updated_at, now))}</text>`;
			return poster(i, posters[i], x, y, p) + title + date;
		})
		.join("");
	return header + cells;
}

export function renderStats(
	stats: Stats,
	recent: Entry[],
	posters: (string | undefined)[],
	p: Palette,
	now: Date = new Date(),
): string {
	const rows = Math.ceil(recent.length / 2);
	const height = rows
		? LAYOUT.gridTop + rows * LAYOUT.rowH + (rows - 1) * LAYOUT.rowGap
		: LAYOUT.tileH;
	return card(
		{
			width: LAYOUT.width,
			height,
			palette: p,
			seed: "mal",
			label: "MyAnimeList anime stats",
			title: "Anime Stats",
			font: FONT,
		},
		`<g font-family="${FONT_STACK}">${tiles(stats, p)}${rows ? grid(recent, posters, p, now) : ""}</g>`,
	);
}

export function renderFallback(reason: string, p: Palette): string {
	return card(
		{
			width: LAYOUT.width,
			height: 20,
			palette: p,
			seed: "mal",
			label: `MyAnimeList anime stats: unavailable (${reason})`,
			title: "Anime Stats",
			font: FONT,
		},
		`<text x="0" y="15" font-family="${FONT_STACK}" font-size="13" fill="${p.subtext}"><tspan fill="${p.accent}">// SIGNAL LOST</tspan> · ${esc(reason)}</text>`,
	);
}
