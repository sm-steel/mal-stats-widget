"""Vercel serverless function: renders a Catppuccin 'MAL stats' SVG card for
MyAnimeList, backed by the official MAL API v2 (Client-ID-only auth — the
official API restricts GET /users/{username} to "@me", but
GET /users/{username}/animelist works for any public username with just an
X-MAL-Client-ID header, no OAuth login flow needed).

Styled to match sm-steel/sm-steel's other profile-README card blocks exactly
(../scripts/render-cards.mjs there, and sm-steel/ym-nowplaying-widget), same
900px width, same outer/card padding, radius, palette hex values, and
Monaspace Neon font (embedded as a base64 @font-face).

Env vars:
    MAL_CLIENT_ID — from https://myanimelist.net/apiconfig
    MAL_USERNAME  — the public MAL profile to read

Query params:
    theme=dark|light — defaults to dark.

Days-watched is computed from average_episode_duration * episodes_watched per
entry (MAL doesn't expose a precomputed total for this via Client-ID-only
auth — that field only appears on the OAuth-only @me/statistics response).

Poster art for the "recently watched" row is fetched server-side (concurrently)
and embedded as base64 data URIs, same reason as the cover art in the Yandex
Music widget — an SVG shown via <img> can't fetch external resources.
"""

import base64
import html
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

MAL_CLIENT_ID = os.environ.get("MAL_CLIENT_ID", "")
MAL_USERNAME = os.environ.get("MAL_USERNAME", "")
MAL_API_BASE = "https://api.myanimelist.net/v2"
REQUEST_TIMEOUT = 10
POSTER_FETCH_TIMEOUT = 6
PAGE_LIMIT = 1000
MAX_PAGES = 10  # safety cap — 10k entries is far beyond any real list
RECENT_COUNT = 6

# Matches sm-steel/sm-steel's scripts/render-cards.mjs palettes exactly.
PALETTES = {
    "dark": {
        "base": "#1e1e2e",
        "surface": "#313244",
        "border": "#45475a",
        "text": "#cdd6f4",
        "accent": "#cba6f7",
    },
    "light": {
        "base": "#eff1f5",
        "surface": "#e6e9ef",
        "border": "#ccd0da",
        "text": "#4c4f69",
        "accent": "#8839ef",
    },
}

WIDTH = 900
OUTER_PAD = 16
CARD_PAD_X, CARD_PAD_Y = 24, 20
CARD_RADIUS = 14
CARD_WIDTH = WIDTH - OUTER_PAD * 2
CONTENT_X = OUTER_PAD + CARD_PAD_X
CONTENT_TOP = OUTER_PAD + CARD_PAD_Y
CONTENT_WIDTH = CARD_WIDTH - CARD_PAD_X * 2  # everything below is positioned inside this

TITLE_BASELINE = CONTENT_TOP + 20

# Stats row: each stat gets its own background panel (not just floating text),
# sized/gapped to exactly fill CONTENT_WIDTH so it lines up with the title
# and grid below instead of overhanging past the card's own padding.
NUM_STATS = 5
STATS_GAP = 10
STATS_PANEL_W = (CONTENT_WIDTH - STATS_GAP * (NUM_STATS - 1)) / NUM_STATS
STATS_PANEL_TOP = TITLE_BASELINE + 18
STATS_PANEL_H = 64
STATS_PANEL_RADIUS = 10
STATS_VALUE_BASELINE = STATS_PANEL_TOP + 30
STATS_LABEL_BASELINE = STATS_PANEL_TOP + 50

SUBTITLE_BASELINE = STATS_PANEL_TOP + STATS_PANEL_H + 30

# Recently-watched: 2 columns x 3 rows, poster on the left + title (+ watched
# date) to the right (a list layout gives titles far more horizontal room
# than a single row of 6 narrow poster-on-top tiles, where titles were
# getting cut off). Row heights are computed per-request (see
# _render_posters_grid): a title can need more lines than fit inside
# POSTER_H, so each row grows to fit its tallest column instead of
# clipping/ellipsizing long titles.
GRID_TOP = SUBTITLE_BASELINE + 16
GRID_COLS, GRID_ROWS = 2, 3
GRID_COL_GAP, GRID_ROW_GAP = 24, 12
GRID_COL_W = (CONTENT_WIDTH - GRID_COL_GAP * (GRID_COLS - 1)) / GRID_COLS
POSTER_W, POSTER_H, POSTER_RADIUS = 60, 84, 6
TITLE_TEXT_GAP = 14
TITLE_TEXT_WIDTH = GRID_COL_W - POSTER_W - TITLE_TEXT_GAP
TITLE_LINE_HEIGHT = 16
TITLE_FIRST_BASELINE_OFFSET = 13  # top-aligned, not vertically centered
TITLE_MAX_CHARS = 34
TITLE_MAX_LINES = 6  # generous safety cap — ellipsis is a last resort, not the norm
DATE_FONT_SIZE = 11

# Fallback card (no grid content) is just title + one centered message line.
FALLBACK_HEIGHT = OUTER_PAD * 2 + CARD_PAD_Y * 2 + 80

_FONT_FAMILY = "'Monaspace Neon', ui-monospace, monospace"
_FONTS_DIR = Path(__file__).parent / "fonts"


def _font_data_uri(filename: str) -> str:
    data = (_FONTS_DIR / filename).read_bytes()
    return "data:font/woff2;base64," + base64.b64encode(data).decode()


_FONT_FACES = f"""
    @font-face {{
      font-family: 'Monaspace Neon';
      src: url({_font_data_uri("monaspace-neon-400.woff2")}) format('woff2');
      font-weight: 400;
      font-style: normal;
    }}
    @font-face {{
      font-family: 'Monaspace Neon';
      src: url({_font_data_uri("monaspace-neon-700.woff2")}) format('woff2');
      font-weight: 700;
      font-style: normal;
    }}
""".strip()


class MalApiError(Exception):
    pass


def _fetch_full_animelist(username: str, client_id: str) -> list[dict]:
    entries: list[dict] = []
    params = {"fields": "list_status,average_episode_duration", "limit": PAGE_LIMIT}
    url = f"{MAL_API_BASE}/users/{username}/animelist?{urlencode(params)}"

    for _ in range(MAX_PAGES):
        if not url.startswith(f"{MAL_API_BASE}/"):
            raise MalApiError(f"refusing to follow pagination link off-API: {url!r}")

        request = urllib.request.Request(url, headers={"X-MAL-Client-ID": client_id})  # noqa: S310
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:  # noqa: S310
                payload = json.loads(response.read())
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            raise MalApiError(f"animelist fetch failed: {e}") from e

        entries.extend(payload.get("data", []))
        next_url = payload.get("paging", {}).get("next")
        if not next_url:
            break
        url = next_url

    return entries


def _compute_stats(entries: list[dict]) -> dict:
    status_counts: dict[str, int] = {}
    scores = []
    total_seconds = 0.0

    for entry in entries:
        status = entry.get("list_status", {})
        s = status.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

        score = status.get("score", 0)
        if score:
            scores.append(score)

        watched = status.get("num_episodes_watched", 0)
        duration = entry.get("node", {}).get("average_episode_duration", 0)
        total_seconds += watched * duration

    return {
        "total": len(entries),
        "completed": status_counts.get("completed", 0),
        "watching": status_counts.get("watching", 0),
        "mean_score": (sum(scores) / len(scores)) if scores else 0.0,
        "days_watched": total_seconds / 86400,
    }


def _recently_watched(entries: list[dict], count: int) -> list[dict]:
    watched = [e for e in entries if e.get("list_status", {}).get("status") != "plan_to_watch"]
    watched.sort(key=lambda e: e.get("list_status", {}).get("updated_at", ""), reverse=True)
    return watched[:count]


def _fetch_poster_data_uri(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=POSTER_FETCH_TIMEOUT) as response:  # noqa: S310
            image_bytes = response.read()
            content_type = response.headers.get_content_type() or "image/jpeg"
    except (urllib.error.URLError, OSError):
        return ""
    return f"data:{content_type};base64,{base64.b64encode(image_bytes).decode()}"


def _fetch_posters(entries: list[dict]) -> list[str]:
    urls = [e.get("node", {}).get("main_picture", {}).get("medium", "") for e in entries]
    with ThreadPoolExecutor(max_workers=max(len(urls), 1)) as pool:
        return list(pool.map(lambda u: _fetch_poster_data_uri(u) if u else "", urls))


def _relative_time(iso_str: str) -> str:
    if not iso_str:
        return ""
    try:
        watched_at = datetime.fromisoformat(iso_str)
    except ValueError:
        return ""

    delta = datetime.now(UTC) - watched_at
    days = delta.days
    if days < 1:
        hours = delta.seconds // 3600
        return "today" if hours < 1 else f"{hours}h ago"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < 30:
        return f"{days // 7}w ago"
    if days < 365:
        return f"{days // 30}mo ago"
    return f"{days // 365}y ago"


def _wrap_lines(text: str, max_chars: int, max_lines: int) -> list[str]:
    """Greedy word-wrap into at most max_lines lines of at most max_chars each,
    ellipsizing the last line if words remain unconsumed."""
    words = text.split()
    lines: list[str] = []
    current = ""
    i = 0
    while i < len(words) and len(lines) < max_lines:
        candidate = f"{current} {words[i]}".strip()
        if len(candidate) <= max_chars or not current:
            current = candidate[:max_chars]
            i += 1
        else:
            lines.append(current)
            current = ""
    if current:
        lines.append(current)
    if i < len(words) and lines:
        last = lines[-1]
        if len(last) > max_chars - 1:
            last = last[: max_chars - 1].rstrip()
        lines[-1] = last.rstrip() + "…"
    return lines


def _svg_shell(theme: str, height: float, body_lines: list[str]) -> str:
    p = PALETTES[theme]
    card_height = height - OUTER_PAD * 2
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}"'
        f' viewBox="0 0 {WIDTH} {height}">',
        f"  <style>{_FONT_FACES}</style>",
        f'  <rect width="{WIDTH}" height="{height}" fill="{p["base"]}" />',
        f'  <rect x="{OUTER_PAD}" y="{OUTER_PAD}" width="{CARD_WIDTH}" height="{card_height}"'
        f' rx="{CARD_RADIUS}" ry="{CARD_RADIUS}" fill="{p["surface"]}"'
        f' stroke="{p["border"]}" stroke-width="1" />',
        *body_lines,
        "</svg>",
    ]
    return "\n".join(lines)


def _render_title(p: dict) -> str:
    return (
        f'  <text x="{CONTENT_X}" y="{TITLE_BASELINE}" font-family="{_FONT_FAMILY}"'
        f' font-size="20" font-weight="700" fill="{p["accent"]}">Anime Stats</text>'
    )


def _render_subtitle(p: dict) -> str:
    return (
        f'  <text x="{CONTENT_X}" y="{SUBTITLE_BASELINE}" font-family="{_FONT_FAMILY}"'
        f' font-size="14" font-weight="700" fill="{p["accent"]}">Recently Watched</text>'
    )


def _render_stats_row(p: dict, stats: dict) -> list[str]:
    tiles = [
        ("Total", str(stats["total"])),
        ("Completed", str(stats["completed"])),
        ("Watching", str(stats["watching"])),
        ("Mean Score", f"{stats['mean_score']:.1f}"),
        ("Days Watched", f"{stats['days_watched']:.1f}"),
    ]
    body = []
    for i, (label, value) in enumerate(tiles):
        panel_x = CONTENT_X + i * (STATS_PANEL_W + STATS_GAP)
        cx = panel_x + STATS_PANEL_W / 2
        body.append(
            f'  <rect x="{panel_x}" y="{STATS_PANEL_TOP}" width="{STATS_PANEL_W}"'
            f' height="{STATS_PANEL_H}" rx="{STATS_PANEL_RADIUS}" ry="{STATS_PANEL_RADIUS}"'
            f' fill="{p["base"]}" stroke="{p["border"]}" stroke-width="1" />'
        )
        body.append(
            f'  <text x="{cx}" y="{STATS_VALUE_BASELINE}" font-family="{_FONT_FAMILY}"'
            f' font-size="26" font-weight="700" fill="{p["accent"]}"'
            f' text-anchor="middle">{html.escape(value)}</text>'
        )
        body.append(
            f'  <text x="{cx}" y="{STATS_LABEL_BASELINE}" font-family="{_FONT_FAMILY}"'
            f' font-size="13" font-weight="400" fill="{p["text"]}"'
            f' text-anchor="middle">{html.escape(label)}</text>'
        )
    return body


def _render_posters_grid(
    p: dict, entries: list[dict], posters: list[str]
) -> tuple[list[str], float]:
    """Row heights are computed per-request: a title's wrapped line count can
    exceed POSTER_H, so each row grows to fit its tallest column (top-aligned
    text, not vertically centered/clipped) instead of ellipsizing.

    Returns (svg_lines, bottom_y) — bottom_y is the absolute y of the grid's
    bottom edge, needed by the caller to size the overall card/SVG height.
    """
    titles = [
        entries[i].get("node", {}).get("title", "") if i < len(entries) else ""
        for i in range(RECENT_COUNT)
    ]
    wrapped = [_wrap_lines(t, TITLE_MAX_CHARS, TITLE_MAX_LINES) if t else [] for t in titles]
    watched_ats = [
        _relative_time(entries[i].get("list_status", {}).get("updated_at", ""))
        if i < len(entries)
        else ""
        for i in range(RECENT_COUNT)
    ]
    # date line shares the title's line grid — one extra slot right after the
    # wrapped title lines — so row-height math stays in a single place.
    block_lines = [len(wrapped[i]) + (1 if watched_ats[i] else 0) for i in range(RECENT_COUNT)]

    body = []
    row_y = GRID_TOP
    for row in range(GRID_ROWS):
        max_lines = max(block_lines[row * 2], block_lines[row * 2 + 1], 1)
        text_block_h = TITLE_FIRST_BASELINE_OFFSET + (max_lines - 1) * TITLE_LINE_HEIGHT + 4
        row_height = max(POSTER_H, text_block_h)

        for col in range(GRID_COLS):
            i = row * 2 + col
            col_x = CONTENT_X + col * (GRID_COL_W + GRID_COL_GAP)

            clip_id = f"poster-clip-{i}"
            body.append(
                f'  <clipPath id="{clip_id}"><rect x="{col_x}" y="{row_y}" width="{POSTER_W}"'
                f' height="{POSTER_H}" rx="{POSTER_RADIUS}" ry="{POSTER_RADIUS}" /></clipPath>'
            )
            body.append(
                f'  <rect x="{col_x}" y="{row_y}" width="{POSTER_W}" height="{POSTER_H}"'
                f' rx="{POSTER_RADIUS}" ry="{POSTER_RADIUS}" fill="{p["border"]}" />'
            )
            data_uri = posters[i] if i < len(posters) else ""
            if data_uri:
                href = html.escape(data_uri, quote=True)
                body.append(
                    f'  <image href="{href}" x="{col_x}" y="{row_y}" width="{POSTER_W}"'
                    f' height="{POSTER_H}" clip-path="url(#{clip_id})"'
                    f' preserveAspectRatio="xMidYMid slice" />'
                )

            lines = wrapped[i]
            if lines:
                text_x = col_x + POSTER_W + TITLE_TEXT_GAP
                first_baseline = row_y + TITLE_FIRST_BASELINE_OFFSET
                for line_i, line in enumerate(lines):
                    y = first_baseline + line_i * TITLE_LINE_HEIGHT
                    body.append(
                        f'  <text x="{text_x}" y="{y}" font-family="{_FONT_FAMILY}"'
                        f' font-size="13" font-weight="400"'
                        f' fill="{p["text"]}">{html.escape(line)}</text>'
                    )

                watched_at = watched_ats[i]
                if watched_at:
                    date_y = first_baseline + len(lines) * TITLE_LINE_HEIGHT
                    body.append(
                        f'  <text x="{text_x}" y="{date_y}" font-family="{_FONT_FAMILY}"'
                        f' font-size="{DATE_FONT_SIZE}" font-weight="400"'
                        f' fill="{p["text"]}" fill-opacity="0.6">'
                        f"{html.escape(watched_at)}</text>"
                    )

        row_y += row_height + GRID_ROW_GAP

    bottom_y = row_y - GRID_ROW_GAP
    return body, bottom_y


def render_svg(theme: str, stats: dict, recent_entries: list[dict], posters: list[str]) -> str:
    p = PALETTES[theme]
    grid_lines, grid_bottom_y = _render_posters_grid(p, recent_entries, posters)
    body = [
        _render_title(p),
        *_render_stats_row(p, stats),
        _render_subtitle(p),
        *grid_lines,
    ]
    height = grid_bottom_y + CARD_PAD_Y + OUTER_PAD
    return _svg_shell(theme, height, body)


def render_fallback(theme: str, message: str) -> str:
    p = PALETTES[theme]
    body = [
        _render_title(p),
        f'  <text x="{WIDTH / 2}" y="{FALLBACK_HEIGHT / 2 + 6}" font-family="{_FONT_FAMILY}"'
        f' font-size="16" font-weight="400" fill="{p["text"]}"'
        f' text-anchor="middle">{html.escape(message)}</text>',
    ]
    return _svg_shell(theme, FALLBACK_HEIGHT, body)


def fetch_stats_svg(theme: str) -> str:
    if not MAL_CLIENT_ID:
        return render_fallback(theme, "MAL_CLIENT_ID not configured")
    if not MAL_USERNAME:
        return render_fallback(theme, "MAL_USERNAME not configured")

    entries = _fetch_full_animelist(MAL_USERNAME, MAL_CLIENT_ID)
    stats = _compute_stats(entries)
    recent_entries = _recently_watched(entries, RECENT_COUNT)
    posters = _fetch_posters(recent_entries)
    return render_svg(theme, stats, recent_entries, posters)


class handler(BaseHTTPRequestHandler):  # noqa: N801 -- Vercel requires this exact name
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        theme = query.get("theme", ["dark"])[0]
        if theme not in PALETTES:
            theme = "dark"

        try:
            svg = fetch_stats_svg(theme)
        except Exception as e:
            svg = render_fallback(theme, f"error: {type(e).__name__}")

        body = svg.encode("utf-8")
        cache_control = "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600"

        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
