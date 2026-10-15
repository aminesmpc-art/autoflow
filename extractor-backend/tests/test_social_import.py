"""No platform network access, cookies or AI calls. Exercise download boundary."""
import asyncio
import time
from pathlib import Path

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import imports
from app.main import app
from app.social_download import canonical_video, public_destination
from app import social_download

real_active_account = imports.active_account


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(imports.settings, 'social_imports_enabled', True)
    monkeypatch.setattr(imports.settings, 'jwt_secret_key', 'motion-test-signing-key-not-production')
    monkeypatch.setattr(imports.settings, 'redis_url', '')
    monkeypatch.setattr(imports.settings, 'social_imports_per_hour', 10)
    imports._active.clear()
    imports._counts.clear()
    async def active(_token):
        pass
    monkeypatch.setattr(imports, 'active_account', active)


def auth(kind='access', expiry=None):
    token = jwt.encode({'user_id': 'test-user', 'token_type': kind, 'exp': expiry or time.time() + 300}, imports.settings.jwt_secret_key, algorithm='HS256')
    return {'Authorization': f'Bearer {token}'}


def post(client, **changes):
    return client.post('/api/imports/video', headers=auth(), json={'url': 'https://www.youtube.com/watch?v=AbCdEfGh_12', 'reuse_permission': True, **changes})


@pytest.mark.parametrize('url', ['http://www.youtube.com/watch?v=AbCdEfGh_12', 'https://127.0.0.1/a', 'https://www.youtube.com.evil.test/watch?v=AbCdEfGh_12', 'https://user:pass@www.youtube.com/watch?v=AbCdEfGh_12', 'https://www.youtube.com:444/watch?v=AbCdEfGh_12', 'https://www.youtube.com/playlist?list=abc', 'file:///etc/passwd'])
def test_bad_url(url):
    with pytest.raises(ValueError):
        canonical_video(url)


@pytest.mark.parametrize('url,expected', [
    ('https://youtu.be/AbCdEfGh_12?si=tracking', 'https://www.youtube.com/watch?v=AbCdEfGh_12'),
    ('https://www.youtube.com/shorts/AbCdEfGh_12', 'https://www.youtube.com/watch?v=AbCdEfGh_12'),
    ('https://www.instagram.com/reel/abc12/?utm=x', 'https://www.instagram.com/reel/abc12/'),
    ('https://www.tiktok.com/@creator/video/123?tracking=x', 'https://www.tiktok.com/@creator/video/123'),
    ('https://vm.tiktok.com/abc/', 'https://vm.tiktok.com/abc/'),
])
def test_supported_link(url, expected):
    assert canonical_video(url) == expected


@pytest.mark.parametrize('ip', ['127.0.0.1','10.0.0.2','169.254.169.254','192.168.1.2','::1','::ffff:127.0.0.1','224.0.0.1','0.0.0.0','fc00::1'])
def test_private_redirect_dns_blocked(monkeypatch, ip):
    monkeypatch.setattr('socket.getaddrinfo', lambda *args, **kwargs: [(2,1,6,'',(ip,443))])
    with pytest.raises(OSError):
        public_destination(('trusted-looking-site.example',443))


def test_public_ip_is_pinned_and_other_ports_blocked(monkeypatch):
    monkeypatch.setattr('socket.getaddrinfo', lambda *args, **kwargs: [(2,1,6,'',('8.8.8.8',443))])
    assert public_destination(('public.example',443)) == ('8.8.8.8',443)
    with pytest.raises(OSError):
        public_destination(('public.example',22))


def test_auth_consent_disabled_and_refresh_block_before_work(monkeypatch):
    client = TestClient(app)
    assert client.post('/api/imports/video', json={'url': 'x'}).status_code == 401
    assert post(client, reuse_permission=False).status_code == 400
    assert client.post('/api/imports/video', headers=auth('refresh'), json={'url': 'x'}).status_code == 401
    assert client.post('/api/imports/video', headers=auth(expiry=time.time()-1), json={'url': 'x'}).status_code == 401
    monkeypatch.setattr(imports.settings, 'social_imports_enabled', False)
    assert post(client).status_code == 503


def test_success_streams_and_removes_tempfile(monkeypatch):
    seen = []
    async def download(url, directory, disconnected):
        root = Path(directory); seen.append(root)
        path = root/'source.mp4'; path.write_bytes(b'\0\0\0\x18ftypmp42')
        return path,'mp4'
    monkeypatch.setattr(imports, 'run_download', download)
    response = post(TestClient(app))
    assert response.status_code == 200
    assert response.headers['content-type'] == 'video/mp4'
    assert response.headers['cache-control'] == 'no-store'
    assert response.content == b'\0\0\0\x18ftypmp42'
    assert not seen[0].exists()
    assert not imports._active


@pytest.mark.parametrize('error,code', [(ValueError('Restricted video'),422),(TimeoutError(),504)])
def test_failure_removes_tempfile(monkeypatch, error, code):
    seen = []
    async def download(url,directory,disconnected):
        seen.append(Path(directory)); raise error
    monkeypatch.setattr(imports,'run_download',download)
    assert post(TestClient(app)).status_code == code
    assert not seen[0].exists()
    assert not imports._active


def test_rate_and_concurrency_are_not_generation_quota(monkeypatch):
    monkeypatch.setattr(imports.settings,'social_imports_per_hour',1)
    imports.admit('rate-user')
    with pytest.raises(HTTPException) as exc:
        imports.admit('rate-user')
    assert exc.value.status_code == 429
    imports._active.add('test-user')
    assert post(TestClient(app)).status_code == 429


def test_account_service_fails_closed(monkeypatch):
    monkeypatch.setattr(imports,'active_account',real_active_account)
    class Unavailable:
        async def __aenter__(self):
            raise imports.httpx.ConnectError('Fixture outage')
        async def __aexit__(self,*args):
            pass
    monkeypatch.setattr(imports.httpx,'AsyncClient',lambda **kwargs: Unavailable())
    assert post(TestClient(app)).status_code == 503
    assert not imports._active


def test_cleanup_when_response_send_fails(tmp_path):
    path = tmp_path/'source.mp4'; path.write_bytes(b'video')
    cleaned = []
    response = imports.TemporaryVideo(path, cleanup=lambda: cleaned.append(True))
    async def bad_send(_message):
        raise OSError('Disconnected')
    async def receive():
        return {'type':'http.disconnect'}
    with pytest.raises(OSError):
        asyncio.run(response({'type':'http','method':'GET','headers':[]},receive,bad_send))
    assert cleaned == [True]


@pytest.mark.parametrize('change', [
    {'is_live':True}, {'has_drm':True}, {'age_limit':18}, {'availability':'private'},
    {'duration':601}, {'duration':0}, {'protocol':'rtmp'}, {'id':'wrong-video'},
])
def test_worker_blocks_restricted_or_wrong_media_before_download(tmp_path, monkeypatch, change):
    import yt_dlp
    from types import SimpleNamespace
    info = {'id':'AbCdEfGh_12','extractor_key':'Youtube','duration':10,'protocol':'https',**change}
    closed, downloads = [], []
    class FixtureDownloader:
        def __init__(self, options):
            self.options = options
            self._request_director = SimpleNamespace(handlers={'Urllib':object(),'Requests':SimpleNamespace(close=lambda: closed.append(True))})
        def __enter__(self):
            return self
        def __exit__(self,*args):
            pass
        def extract_info(self,url,download):
            assert download is False
            return info
        def process_info(self,info):
            downloads.append(info)
    monkeypatch.setattr(social_download,'guard_network',lambda: None)
    monkeypatch.setattr(yt_dlp,'YoutubeDL',FixtureDownloader)
    with pytest.raises(ValueError):
        social_download.download_worker('https://www.youtube.com/watch?v=AbCdEfGh_12',str(tmp_path))
    assert closed == [True]
    assert not downloads


def test_actual_urllib_handler_cannot_connect_to_private_ip(monkeypatch):
    import socket
    from yt_dlp import YoutubeDL
    # Restore the process-wide socket class after this isolated check.
    with monkeypatch.context() as guard:
        guard.setattr(socket,'socket',socket.socket)
        social_download.guard_network()
        with YoutubeDL({'proxy':'','js_runtimes':{},'remote_components':[]}) as downloader:
            for name in list(downloader._request_director.handlers):
                if name != 'Urllib':
                    downloader._request_director.handlers.pop(name).close()
            with pytest.raises(Exception, match='Private network'):
                downloader.urlopen('http://127.0.0.1:80/')


def test_real_ytdlp_single_download_reaches_file_handoff(tmp_path, monkeypatch):
    import json
    import yt_dlp
    from yt_dlp.globals import plugin_dirs
    from yt_dlp.downloader.external import FFmpegFD
    original = yt_dlp.YoutubeDL
    class FixtureDownloader(original):
        def extract_info(self,url,download=False):
            assert download is False
            return self.process_video_result({
                'id':'AbCdEfGh_12','title':'Owned synthetic fixture',
                'extractor':'youtube','extractor_key':'Youtube',
                'duration':1,'availability':'public',
                'formats':[{'format_id':'fixture','url':'https://public.example/video.mp4',
                            'protocol':'https','ext':'mp4','height':360,'vcodec':'avc1','acodec':'mp4a'}],
            }, download=False)
        def dl(self,name,info,subtitle=False,test=False):
            Path(name).write_bytes(b'\0\0\0\x18ftypmp42' + b'fixture-media')
            return True,True
    monkeypatch.setattr(yt_dlp,'YoutubeDL',FixtureDownloader)
    monkeypatch.setattr(social_download,'guard_network',lambda: None)
    monkeypatch.setattr(plugin_dirs,'value',plugin_dirs.value)
    monkeypatch.setattr(FFmpegFD,'real_download',FFmpegFD.real_download)
    social_download.download_worker('https://www.youtube.com/watch?v=AbCdEfGh_12',str(tmp_path))
    assert json.loads((tmp_path/'result.json').read_text()) == {'file':'source.mp4','kind':'mp4'}
    assert (tmp_path/'source.mp4').exists()
    with pytest.raises(ValueError, match='unsupported external downloader'):
        FFmpegFD.real_download(None,'unused',{'url':'http://169.254.169.254/'})
