"""
YouTube links the server is not allowed to download.

From a datacenter address YouTube often answers a download with "Sign in to
confirm you're not a bot", and the extraction fails. But the model can read a
public YouTube video from its link by itself — verified on Vertex with
gemini-3.7-flash, whole and clipped to a window — so the server does not need
the file to write the prompts.

It does need the video's LENGTH, and that it must not take from the model.
The length plans the windows, bounds the section the user chose, and is what
a length-weighted quota charges for; a number the model guessed would do all
three wrong without anyone noticing. So it comes from YouTube, by whichever
of these answers first:

  1. the YouTube Data API, when YOUTUBE_API_KEY is set — free, and never
     bot-checked, which makes it the one to rely on
  2. yt-dlp asked for the details only, without downloading
  3. the watch page's own "lengthSeconds"

If none answers, the caller reports the original download error.

What a reading from the link cannot have: shot thumbnails and cut-exact
timings, because both need the file. The result says so.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}


def youtube_id(url: str) -> Optional[str]:
    """The video id of a YouTube watch, short, embed or share link."""
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host not in _HOSTS:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if host.endswith("youtu.be"):
        candidate = parts[0] if parts else ""
    elif parts[:1] == ["watch"]:
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    elif len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
        candidate = parts[1]
    else:
        candidate = ""
    return candidate if _ID.match(candidate) else None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def cover_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


@dataclass
class Details:
    duration_sec: float
    title: str = ""
    # Which source answered — for the logs, when one of them stops working.
    via: str = ""


_ISO = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")


def parse_iso_duration(text: str) -> Optional[float]:
    """'PT1H2M3S' → 3723. The Data API's format; None for anything else."""
    m = _ISO.match((text or "").strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = m.groups()
    return int(d or 0) * 86400 + int(h or 0) * 3600 + int(mi or 0) * 60 + float(s or 0)


class NotReadable(Exception):
    """YouTube says the video is private, live, or otherwise not a public
    recording — the model could not read it either."""


async def _from_data_api(video_id: str, key: str) -> Optional[Details]:
    import httpx

    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "contentDetails,snippet,status", "id": video_id, "key": key},
        )
    if r.status_code != 200:
        log.warning("YouTube Data API answered %s", r.status_code)
        return None
    items = r.json().get("items") or []
    if not items:
        raise NotReadable("YouTube has no public video with that link.")
    item = items[0]
    if (item.get("status") or {}).get("privacyStatus") == "private":
        raise NotReadable("That YouTube video is private.")
    if (item.get("snippet") or {}).get("liveBroadcastContent") in {"live", "upcoming"}:
        raise NotReadable("That YouTube video is a live stream that has not finished.")
    duration = parse_iso_duration((item.get("contentDetails") or {}).get("duration", ""))
    if not duration:
        return None
    return Details(duration, (item.get("snippet") or {}).get("title", ""), "data-api")


async def _from_ytdlp(url: str, ydl_opts: dict) -> Optional[Details]:
    import yt_dlp

    def _info():
        with yt_dlp.YoutubeDL({**ydl_opts, "skip_download": True}) as ydl:
            return ydl.extract_info(url, download=False)

    info = await asyncio.to_thread(_info)
    duration = (info or {}).get("duration")
    if not duration:
        return None
    return Details(float(duration), info.get("title") or "", "yt-dlp")


_LENGTH = re.compile(r'"lengthSeconds"\s*:\s*"(\d+)"')
_TITLE = re.compile(r'<meta\s+name="title"\s+content="([^"]*)"')


async def _from_watch_page(video_id: str) -> Optional[Details]:
    import html

    import httpx

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        r = await client.get(
            watch_url(video_id),
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
    if r.status_code != 200:
        return None
    length = _LENGTH.search(r.text)
    if not length or int(length.group(1)) <= 0:
        return None
    title = _TITLE.search(r.text)
    return Details(float(length.group(1)), html.unescape(title.group(1)) if title else "", "watch-page")


async def youtube_details(video_id: str, *, ydl_opts: Optional[dict] = None) -> Optional[Details]:
    """
    The video's length from YouTube itself, or None if nothing would say.

    Raises NotReadable when YouTube positively says the video cannot be read
    (private, live) — that is an answer, not a failure to get one, and
    trying the other sources would only delay telling the person.
    """
    key = os.getenv("YOUTUBE_API_KEY", "").strip().strip("\"'")
    attempts = []
    if key:
        attempts.append(("data-api", lambda: _from_data_api(video_id, key)))
    attempts.append(("yt-dlp", lambda: _from_ytdlp(watch_url(video_id), ydl_opts or {"quiet": True})))
    attempts.append(("watch-page", lambda: _from_watch_page(video_id)))

    for name, attempt in attempts:
        try:
            details = await attempt()
        except NotReadable:
            raise
        except Exception as exc:                               # noqa: BLE001
            log.warning("YouTube details via %s failed: %s", name, str(exc)[:200])
            continue
        if details:
            return details
    return None
