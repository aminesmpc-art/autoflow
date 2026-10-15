"""Bounded, public-video downloads. No AI, site cookies or analysis quota."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import signal
import socket
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

MAX_BYTES = 100 * 1024 * 1024
MAX_DURATION = 10 * 60


def canonical_video(value: str) -> str:
    """Never hand an arbitrary URL or yt-dlp command option to the worker."""
    try:
        url = urlsplit(value.strip())
        if url.scheme != "https" or url.username or url.password or url.port:
            raise ValueError
        host, path = url.hostname, url.path
        if host in {"www.youtube.com", "m.youtube.com", "youtube.com", "youtu.be"}:
            video_id = (path[1:] if host == "youtu.be" else
                        path.split("/")[2] if path.startswith("/shorts/") else
                        parse_qs(url.query).get("v", [""])[0] if path == "/watch" else "")
            if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                return f"https://www.youtube.com/watch?v={video_id}"
        if host in {"www.instagram.com", "instagram.com"}:
            match = re.fullmatch(r"/(reel|p)/([A-Za-z0-9_-]+)/?", path)
            if match:
                return f"https://www.instagram.com/{match[1]}/{match[2]}/"
        if host in {"www.tiktok.com", "m.tiktok.com", "tiktok.com"}:
            match = re.fullmatch(r"/@([\w.-]+)/video/(\d+)/?", path)
            if match:
                return f"https://www.tiktok.com/@{match[1]}/video/{match[2]}"
            if re.fullmatch(r"/t/[A-Za-z0-9_-]+/?", path):
                return f"https://www.tiktok.com{path}"
        if host in {"vm.tiktok.com", "vt.tiktok.com"} and re.fullmatch(r"/[A-Za-z0-9_-]+/?", path):
            return f"https://{host}{path}"
    except (ValueError, IndexError):
        pass
    raise ValueError("Use a TikTok video, Instagram Reel/post or YouTube watch/Shorts link.")


def public_destination(address: tuple) -> tuple:
    """Resolve once and connect to the checked IP, including redirects/CDNs.

    Runs only in the isolated downloader. Rejects private, loopback, metadata,
    mapped private IPv6 and non-web ports even after DNS rebinding.
    """
    host, port = address[:2]
    if port not in {80, 443}:
        raise OSError("Only public web connections are permitted")
    answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not answers:
        raise OSError("No public destination")
    for _, _, _, _, dest in answers:
        ip = ipaddress.ip_address(dest[0].split("%")[0])
        ip = (ip.ipv4_mapped or ip) if isinstance(ip, ipaddress.IPv6Address) else ip
        if not ip.is_global or ip.is_multicast:
            raise OSError("Private network destinations are not permitted")
    # Preserve family/flow fields when the caller already supplied an IPv6 tuple.
    return (answers[0][4][0], *address[1:])


def guard_network() -> None:
    original = socket.socket

    class PublicSocket(original):
        def connect(self, address):
            if self.family not in {socket.AF_INET, socket.AF_INET6}:
                raise OSError("Unsupported network family")
            return super().connect(public_destination(address))

        def connect_ex(self, address):
            # Do not quietly fall back to an unchecked destination.
            return super().connect_ex(public_destination(address))

    socket.socket = PublicSocket


def reject_external_download(_downloader, _filename, _info) -> bool:
    raise ValueError("This stream requires an unsupported external downloader. Use Upload file instead.")


def download_worker(url: str, directory: str) -> None:
    """Invoked as a killable child; library networking is forced through urllib."""
    guard_network()
    from yt_dlp import YoutubeDL
    from yt_dlp.downloader.external import FFmpegFD
    from yt_dlp.globals import plugin_dirs
    plugin_dirs.value = []
    # Native HLS can silently delegate unsupported/encrypted manifests to
    # ffmpeg. That subprocess would not inherit our public-IP socket guard.
    # Keep local FFmpegMergerPP available, but never let FFmpegFD fetch URLs.
    FFmpegFD.real_download = reject_external_download
    root = Path(directory)

    def check_info(info, *, incomplete=False):
        if incomplete:
            return None
        if (info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming", "post_live"}
                or info.get("has_drm") or (info.get("age_limit") or 0) > 0
                or info.get("availability") not in {None, "public"}
                or not 0 < float(info.get("duration") or 0) <= MAX_DURATION):
            return "Only public, unrestricted videos up to ten minutes are supported"
        return None

    def size_check(_event):
        if sum(p.stat().st_size for p in root.iterdir() if p.is_file()) > MAX_BYTES:
            raise ValueError("Video exceeds 100 MB")

    options = {
        "outtmpl": str(root / "source.%(ext)s"), "noplaylist": True,
        "quiet": True, "no_warnings": True, "socket_timeout": 15,
        "retries": 1, "fragment_retries": 1, "concurrent_fragment_downloads": 1,
        "max_filesize": MAX_BYTES, "match_filter": check_info,
        "progress_hooks": [size_check], "postprocessor_hooks": [size_check],
        "format": "best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best[height<=720]",
        "merge_output_format": "mp4", "overwrites": False, "continuedl": False,
        "proxy": "", "cachedir": False, "enable_file_urls": False,
        "js_runtimes": {}, "remote_components": [],
        "external_downloader": {"m3u8": "native", "dash": "native"},
    }
    if "tiktok.com/" in url:
        # Download-address formats preserve watermark/creator download intent;
        # never fall back to play-address formats just because downloading failed.
        options["format"] = "download/download_addr"
    with YoutubeDL(options) as downloader:
        # curl/requests/native impersonation must not bypass the socket guard.
        for name in list(downloader._request_director.handlers):
            if name != "Urllib":
                downloader._request_director.handlers.pop(name).close()
        info = downloader.extract_info(canonical_video(url), download=False)
        if not info or info.get("_type", "video") != "video" or check_info(info):
            raise ValueError("Video is unavailable or restricted")
        if "tiktok.com/" in url:
            expected = re.search(r"/video/(\d+)", url)
            if info.get("extractor_key") != "TikTok" or (expected and str(info.get("id")) != expected[1]):
                raise ValueError("The site returned a different video")
        elif "instagram.com/" in url:
            if info.get("extractor_key") != "Instagram":
                raise ValueError("The site returned a different video")
        elif info.get("extractor_key") != "Youtube" or info.get("id") != parse_qs(urlsplit(canonical_video(url)).query)["v"][0]:
            raise ValueError("The site returned a different video")
        # Do not pass RTMP or ffmpeg remote-input protocols to subprocesses.
        formats = info.get("requested_formats") or [info]
        for item in formats:
            if item.get("has_drm") or item.get("protocol") not in {"https", "http", "m3u8_native", "http_dash_segments"}:
                raise ValueError("Unsupported or protected video stream")
        # Respect explicit TikTok creator download restrictions when present.
        if info.get("download_disabled") or info.get("prevent_download"):
            raise ValueError("Creator downloads are disabled")
        downloader.process_info(info)
    size_check({})
    files = [p for p in root.iterdir() if p.name in {"source.mp4", "source.webm"}]
    if len(files) != 1 or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise ValueError("No usable video file")
    with files[0].open("rb") as file:
        header = file.read(12)
    kind = "mp4" if header[4:8] == b"ftyp" else "webm" if header[:4] == b"\x1aE\xdf\xa3" else ""
    if not kind:
        raise ValueError("Not a supported video container")
    (root / "result.json").write_text(json.dumps({"file": files[0].name, "kind": kind}), encoding="utf8")


async def run_download(url: str, directory: str, disconnected, timeout: int = 150) -> tuple[Path, str]:
    args = [sys.executable, "-m", "app.social_download", url, directory]
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        **({"start_new_session": True} if os.name != "nt" else {}),
    )
    deadline = time.monotonic() + timeout
    try:
        while process.returncode is None:
            if await disconnected():
                raise asyncio.CancelledError
            if time.monotonic() > deadline:
                raise TimeoutError("Video download timed out")
            try:
                await asyncio.wait_for(process.wait(), 0.25)
            except asyncio.TimeoutError:
                pass
        if process.returncode != 0:
            raise ValueError("This video could not be downloaded. It may be restricted or the site may be blocking server downloads. Use Upload file instead.")
        result = json.loads((Path(directory) / "result.json").read_text(encoding="utf8"))
        path = Path(directory) / result["file"]
        if path.name not in {"source.mp4", "source.webm"} or path.parent != Path(directory) or result["kind"] not in {"mp4", "webm"}:
            raise ValueError("Invalid download result")
        return path, result["kind"]
    finally:
        if process.returncode is None:
            if os.name == "nt":
                # Also terminate local ffmpeg children on development Windows.
                killer = await asyncio.create_subprocess_exec("taskkill", "/PID", str(process.pid), "/T", "/F", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await killer.wait()
            else:
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()


if __name__ == "__main__":
    download_worker(sys.argv[1], sys.argv[2])
