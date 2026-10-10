/** "today", "5h ago", "yesterday", "3d ago", "2w ago", "1mo ago", "1y ago" (as the Python widget did). */
export function relativeTime(
	iso: string | undefined,
	now: Date = new Date(),
): string {
	const t = iso ? Date.parse(iso) : Number.NaN;
	if (Number.isNaN(t)) return "";
	const seconds = (now.getTime() - t) / 1000;
	const days = Math.floor(seconds / 86400);
	if (days < 1) {
		const hours = Math.floor(seconds / 3600);
		return hours < 1 ? "today" : `${hours}h ago`;
	}
	if (days === 1) return "yesterday";
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.floor(days / 7)}w ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}
