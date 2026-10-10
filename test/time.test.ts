import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/time.js";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
const H = 3600;
const D = 86400;

describe("relativeTime", () => {
	it.each([
		[30 * 60, "today"],
		[5 * H, "5h ago"],
		[D, "yesterday"],
		[3 * D, "3d ago"],
		[15 * D, "2w ago"],
		[45 * D, "1mo ago"],
		[400 * D, "1y ago"],
	])("%i seconds ago → %s", (s, label) => {
		expect(relativeTime(ago(s), now)).toBe(label);
	});
	it("is empty for missing or unparseable dates", () => {
		expect(relativeTime(undefined, now)).toBe("");
		expect(relativeTime("not a date", now)).toBe("");
	});
	it("treats future dates as today", () => {
		expect(relativeTime(ago(-5 * H), now)).toBe("today");
	});
});
