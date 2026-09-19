#!/usr/bin/env python3
"""AMLL 歌词助手的 DaVinci Resolve 普通脚本宿主。

Lua 菜单入口启动独立 Python 宿主，再用本地 JSON-RPC 连接 Electron。
外部 Resolve API 的可用性取决于宿主版本及偏好设置；启动错误会写日志并显示。
"""

import copy
import importlib.util
import json
import logging
import math
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
from fractions import Fraction
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MAX_REQUEST_BYTES = 32 * 1024 * 1024
PLUGIN_ID = "com.edgehh.amll.lyrics"
GENERATED_FOLDER = "AMLL 歌词生成"
TRACK_NAME = "AMLL 歌词"
# Keep DLL search handles alive for the lifetime of the native scripting module.
_DLL_SEARCH_HANDLES = []


class HostError(RuntimeError):
    pass


def values(collection):
    if collection is None:
        return []
    if isinstance(collection, dict):
        return [value for value in collection.values() if value is not None]
    if isinstance(collection, (list, tuple)):
        return [value for value in collection if value is not None]
    return [collection]


def call(obj, name, *args, default=None):
    method = getattr(obj, name, None)
    if not callable(method):
        return default
    return method(*args)


def as_text(value, default=""):
    return default if value is None else str(value)


def find_electron(script_dir):
    configured = os.environ.get("AMLL_RESOLVE_ELECTRON", "").strip()
    paths = []
    if configured:
        paths.append(Path(configured))
    config = script_dir / "resolve-electron.path"
    if config.is_file():
        try:
            paths.insert(0, Path(config.read_text(encoding="utf-8-sig").strip()))
        except OSError:
            pass

    for program_root in filter(None, [os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)")]):
        base = Path(program_root)
        paths.extend([
            base / "Blackmagic Design" / "DaVinci Resolve" / "Electron" / "electron.exe",
            base / "Blackmagic Design" / "DaVinci Resolve Studio" / "Electron" / "electron.exe",
        ])
    for drive in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        paths.extend([
            Path(f"{drive}:/Davinci Resolve/Electron/electron.exe"),
            Path(f"{drive}:/DaVinci Resolve/Electron/electron.exe"),
            Path(f"{drive}:/Davinci Resolve Studio/Electron/electron.exe"),
        ])

    seen = set()
    for path in paths:
        path = Path(path)
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        if path.is_file():
            return path
    raise HostError("找不到 DaVinci Resolve 的 Electron 运行时，请重装插件或设置 AMLL_RESOLVE_ELECTRON 环境变量")


def load_resolve(electron_path):
    # Menu execution may already provide a valid in-process Resolve object.
    embedded = globals().get("resolve")
    if embedded is not None and callable(getattr(embedded, "GetProjectManager", None)):
        return embedded
    resolve_root = electron_path.resolve().parent.parent
    if not os.environ.get("RESOLVE_SCRIPT_LIB", "").strip():
        os.environ["RESOLVE_SCRIPT_LIB"] = str(resolve_root / "fusionscript.dll")
    # An empty environment variable is not a path: Path("") resolves to cwd.
    configured_api = os.environ.get("RESOLVE_SCRIPT_API", "").strip()
    api_root = Path(configured_api) if configured_api else None
    if api_root is None or not (api_root / "Modules" / "DaVinciResolveScript.py").is_file():
        api_root = Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) / "Blackmagic Design" / "DaVinci Resolve" / "Support" / "Developer" / "Scripting"
    module_path = api_root / "Modules" / "DaVinciResolveScript.py"
    if not module_path.is_file():
        raise HostError(f"找不到 Resolve Python API：{module_path}")
    if os.name == "nt":
        # Python 3.8+ no longer searches arbitrary installation folders for dependent DLLs.
        # These changes are process-local; do not alter the user's system Python settings.
        os.environ["PYTHON3HOME"] = sys.base_prefix
        for folder in (resolve_root, Path(sys.base_prefix)):
            if folder.is_dir():
                _DLL_SEARCH_HANDLES.append(os.add_dll_directory(str(folder)))
    spec = importlib.util.spec_from_file_location("DaVinciResolveScript", module_path)
    if spec is None or spec.loader is None:
        raise HostError("无法加载 DaVinciResolveScript.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["DaVinciResolveScript"] = module
    try:
        spec.loader.exec_module(module)
        # Blackmagic's loader replaces its own sys.modules entry with the extension module.
        # The temporary wrapper object does not expose scriptapp.
        api = sys.modules.get("DaVinciResolveScript", module)
        resolve = api.scriptapp("Resolve")
    except Exception as error:
        raise HostError(f"无法加载 Resolve Python 接口：{error}；请核对 64 位 Python 和 Resolve 安装目录") from error
    if resolve is None:
        raise HostError("无法连接到正在运行的 DaVinci Resolve，请先打开 Resolve 再从工作区脚本菜单启动")
    return resolve


def parse_rate(value):
    text = as_text(value).strip()
    try:
        number = float(text)
    except ValueError as error:
        raise HostError(f"时间线帧率无效：{text}") from error
    known = [(23.976, 24000, 1001), (29.97, 30000, 1001), (47.952, 48000, 1001), (59.94, 60000, 1001), (119.88, 120000, 1001)]
    for rounded, numerator, denominator in known:
        if abs(number - rounded) < 0.002:
            return {"numerator": numerator, "denominator": denominator}
    fraction = Fraction(text).limit_denominator(1001)
    return {"numerator": fraction.numerator, "denominator": fraction.denominator}


def context(resolve):
    manager = call(resolve, "GetProjectManager")
    project = call(manager, "GetCurrentProject")
    if project is None:
        raise HostError("请先打开达芬奇项目")
    timeline = call(project, "GetCurrentTimeline")
    if timeline is None:
        raise HostError("请先创建或打开一条时间线")
    name = as_text(call(timeline, "GetName"))
    timeline_id = as_text(call(timeline, "GetUniqueId", default=None), name)
    rate = parse_rate(call(timeline, "GetSetting", "timelineFrameRate"))
    return {
        "project": project,
        "timeline": timeline,
        "info": {
            "id": timeline_id,
            "name": name,
            "frameRate": rate,
            "startFrame": int(call(timeline, "GetStartFrame", default=0)),
            "currentTimecode": as_text(call(timeline, "GetCurrentTimecode", default="00:00:00:00")),
        },
    }


def folder_children(folder):
    return values(call(folder, "GetSubFolderList", default=call(folder, "GetSubFolders", default=[])))


def folder_clips(folder):
    return values(call(folder, "GetClipList", default=call(folder, "GetClips", default=[])))


def scan_media_titles(folder, path_parts=None, result=None):
    path_parts = [] if path_parts is None else path_parts
    result = [] if result is None else result
    name = as_text(call(folder, "GetName"))
    next_parts = path_parts + ([name] if name else [])
    if name != GENERATED_FOLDER:
        for clip in folder_clips(folder):
            props = call(clip, "GetClipProperty", default={}) or {}
            kind = as_text(props.get("Type") or props.get("Clip Type")) if isinstance(props, dict) else ""
            if "fusion" not in kind.lower():
                continue
            unique_id = as_text(call(clip, "GetUniqueId"))
            result.append({
                "id": unique_id,
                "key": f"media:{unique_id}",
                "name": as_text(call(clip, "GetName")),
                "type": kind,
                "path": " / ".join(next_parts),
            })
        for child in folder_children(folder):
            scan_media_titles(child, next_parts, result)
    return result


def title_sources(resolve):
    info = context(resolve)
    media_pool = call(info["project"], "GetMediaPool")
    root = call(media_pool, "GetRootFolder")
    return {
        "builtIn": [{"key": "am-default", "name": "AM Lyrics", "timing": "word"}],
        "mediaPool": scan_media_titles(root) if root is not None else [],
    }


def seconds(milliseconds):
    value = max(0, int(milliseconds)) / 1000
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def code_point_length(text):
    return len(str(text))


def build_am_inputs(line, fps):
    text = as_text(line.get("text"))
    if code_point_length(text) > 256:
        raise HostError(f"第 {line.get('_rangeLine', '?')} 行超过 AM Lyrics 单行 256 字符限制，请先拆行")
    words = line.get("words") or []
    if words:
        if any("|" in as_text(word.get("text")) for word in words):
            raise HostError(f"第 {line.get('_rangeLine', '?')} 行含有“|”，无法安全写入 AM Lyrics 分段语法")
        segments = [as_text(word.get("text")) for word in words]
        timings = [f"{seconds(word['startMs'] - line['startMs'])}-{seconds(word['endMs'] - line['startMs'])}" for word in words]
    else:
        if "|" in text:
            raise HostError(f"第 {line.get('_rangeLine', '?')} 行含有“|”，无法安全写入 AM Lyrics 分段语法")
        segments = [text]
        timings = [f"0-{seconds(line['endMs'] - line['startMs'])}"]
    inputs = {"Lyrics": "|".join(segments), "Timings": "|".join(timings), "Duration": (line["endMs"] - line["startMs"]) / 1000, "Offset": 0, "FPS": fps}
    if line.get("role") == "background":
        inputs["BackgroundVocal"] = 1
    return inputs


def assign_track_lanes(frames):
    lane_ends = []
    lanes = []
    for frame in frames:
        lane = next((index for index, end in enumerate(lane_ends) if end <= frame["startFrame"]), -1)
        if lane < 0:
            lane = len(lane_ends)
            lane_ends.append(frame["endFrameExclusive"])
        else:
            lane_ends[lane] = frame["endFrameExclusive"]
        lanes.append(lane)
    return lanes


def comp_for_item(item):
    count = int(call(item, "GetFusionCompCount", default=0) or 0)
    return call(item, "GetFusionCompByIndex", 1) if count > 0 else None


def configure_am_title(item, line, fps):
    comp = comp_for_item(item)
    if comp is None:
        raise HostError("AM Lyrics 标题没有可编辑的 Fusion 合成")
    macro = call(comp, "FindTool", "AMLLyrics")
    if macro is None:
        raise HostError("所选 AM Lyrics 预设缺少 AMLLyrics 控制器，请重新安装当前版本标题预设")
    for name, value in build_am_inputs(line, fps).items():
        if call(macro, "SetInput", name, value, default=True) is False:
            raise HostError(f"无法写入 AM Lyrics 参数：{name}")


def get_or_create_generated_folder(media_pool):
    root = call(media_pool, "GetRootFolder")
    for folder in folder_children(root):
        if as_text(call(folder, "GetName")) == GENERATED_FOLDER:
            return folder
    created = call(media_pool, "AddSubFolder", root, GENERATED_FOLDER)
    if created is None:
        raise HostError(f"无法在媒体池创建“{GENERATED_FOLDER}”文件夹")
    return created


def create_line_media(media_pool, scratch, line, frame, fps, index):
    duration_frames = frame["endFrameExclusive"] - frame["startFrame"]
    if duration_frames < 1:
        duration_frames = 1
    if call(scratch, "SetCurrentTimecode", call(scratch, "GetStartTimecode", default="00:00:00:00"), default=True) is False:
        raise HostError("无法定位歌词临时时间线")
    if call(scratch, "SetMarkInOut", 0, duration_frames - 1, "video", default=True) is False:
        raise HostError("无法设置临时标题长度")
    source_item = call(scratch, "InsertFusionTitleIntoTimeline", "AM Lyrics")
    if source_item is None:
        raise HostError("找不到 Fusion 标题“AM Lyrics”，请先安装标题预设")
    line = dict(line)
    line["_rangeLine"] = index + 1
    configure_am_title(source_item, line, fps)
    fusion_item = call(scratch, "CreateFusionClip", [source_item])
    if fusion_item is None:
        raise HostError(f"无法为第 {index + 1} 行创建 Fusion 片段")
    media_item = call(fusion_item, "GetMediaPoolItem")
    if media_item is None:
        raise HostError(f"第 {index + 1} 行的 Fusion 片段没有生成媒体池项目")
    short_text = re.sub(r"\s+", " ", as_text(line.get("text"))).strip()[:36] or f"第 {index + 1} 行"
    call(media_item, "SetClipProperty", "Clip Name", f"{index + 1:03d} {short_text}")
    call(scratch, "DeleteClips", [fusion_item], False)
    call(scratch, "ClearMarkInOut", "video")
    return media_item


def render(resolve, job):
    if job.get("schemaVersion") != 2 or job.get("kind") != "amll.resolve.render-job":
        raise HostError("渲染任务版本不受支持，请重新生成任务")
    lines = job.get("document", {}).get("lines") or []
    placement = job.get("placement") or {}
    frames = placement.get("lineFrames") or []
    if not lines or len(lines) != len(frames):
        raise HostError("歌词任务行数与帧区间不一致")
    current = context(resolve)
    timeline = current["timeline"]
    timeline_id = as_text(call(timeline, "GetUniqueId", default=call(timeline, "GetName")))
    if timeline_id != as_text(placement.get("timelineId")):
        raise HostError("当前时间线已变化，请刷新连接后重新导入")
    project = current["project"]
    media_pool = call(project, "GetMediaPool")
    original_folder = call(media_pool, "GetCurrentFolder")
    generated_folder = get_or_create_generated_folder(media_pool)
    title_source = as_text(job.get("render", {}).get("titleSource", "am-default"))
    if not title_source.startswith("am-"):
        raise HostError("普通脚本模式暂只支持 AM Lyrics 标题来源，请选择 AM Lyrics")
    fps_info = placement.get("frameRate") or {"numerator": 24, "denominator": 1}
    fps = float(fps_info["numerator"]) / float(fps_info["denominator"])
    lanes = assign_track_lanes(frames)
    lane_count = max(lanes) + 1
    inserted = []
    generated_media = []
    created_tracks = []
    scratch = None
    final_item = None
    try:
        call(media_pool, "SetCurrentFolder", generated_folder)
        scratch = call(media_pool, "CreateEmptyTimeline", f"AMLL 临时 {int(time.time() * 1000)}")
        if scratch is None:
            raise HostError("无法创建歌词临时时间线")
        if call(project, "SetCurrentTimeline", scratch, default=True) is False:
            raise HostError("无法切换到歌词临时时间线")
        for index, line in enumerate(lines):
            generated_media.append(create_line_media(media_pool, scratch, line, frames[index], fps, index))
        if call(project, "SetCurrentTimeline", timeline, default=True) is False:
            raise HostError("无法切回原时间线")
        old_track_count = int(call(timeline, "GetTrackCount", "video", default=0) or 0)
        for lane in range(lane_count):
            if call(timeline, "AddTrack", "video", default=True) is False:
                raise HostError("无法创建新的顶部视频轨道")
            track_index = old_track_count + lane + 1
            created_tracks.append(track_index)
            call(timeline, "SetTrackName", "video", track_index, TRACK_NAME if lane_count == 1 else f"{TRACK_NAME} {lane + 1}")
        clip_infos = []
        for index, media_item in enumerate(generated_media):
            clip_infos.append({
                "mediaPoolItem": media_item,
                "startFrame": 0,
                "endFrame": frames[index]["endFrameExclusive"] - frames[index]["startFrame"],
                "mediaType": 1,
                "trackIndex": old_track_count + lanes[index] + 1,
                "recordFrame": frames[index]["startFrame"],
            })
        inserted = values(call(media_pool, "AppendToTimeline", clip_infos))
        if len(inserted) != len(clip_infos):
            raise HostError(f"只创建了 {len(inserted)}/{len(clip_infos)} 个歌词片段")
        for index, item in enumerate(inserted):
            expected = clip_infos[index]["endFrame"]
            actual = int(call(item, "GetDuration", default=expected) or expected)
            if actual != expected:
                raise HostError(f"第 {index + 1} 行长度写入异常：期望 {expected} 帧，实际 {actual} 帧")
        if job.get("render", {}).get("placementMode") == "fusion-clip":
            final_item = call(timeline, "CreateFusionClip", inserted)
            if final_item is None:
                raise HostError("歌词已散落写入，但创建汇总 Fusion 片段失败")
            call(final_item, "SetName", f"AMLL {as_text(job.get('document', {}).get('source', {}).get('title'), '歌词')}")
            for track_index in sorted(created_tracks, reverse=True):
                if not values(call(timeline, "GetItemListInTrack", "video", track_index)):
                    call(timeline, "DeleteTrack", "video", track_index)
        return {
            "insertedCount": 1 if final_item is not None else len(inserted),
            "sourceLineCount": len(inserted),
            "createdTrackCount": 1 if final_item is not None else lane_count,
            "timing": job.get("document", {}).get("timing", "line"),
            "message": f"已写入 {len(inserted)} 行歌词。",
        }
    except Exception as error:
        try:
            call(project, "SetCurrentTimeline", timeline)
        except Exception:
            pass
        try:
            if final_item is not None:
                call(timeline, "DeleteClips", [final_item], False)
            elif inserted:
                call(timeline, "DeleteClips", inserted, False)
        except Exception:
            pass
        try:
            for track_index in sorted(created_tracks, reverse=True):
                if not values(call(timeline, "GetItemListInTrack", "video", track_index)):
                    call(timeline, "DeleteTrack", "video", track_index)
        except Exception:
            pass
        try:
            if scratch is not None:
                call(media_pool, "DeleteTimelines", [scratch])
        except Exception:
            pass
        try:
            if generated_media:
                call(media_pool, "DeleteClips", generated_media)
        except Exception:
            pass
        if isinstance(error, HostError):
            raise
        raise HostError(str(error)) from error
    finally:
        try:
            call(project, "SetCurrentTimeline", timeline)
        except Exception:
            pass
        try:
            if scratch is not None:
                call(media_pool, "DeleteTimelines", [scratch])
        except Exception:
            pass
        try:
            call(media_pool, "SetCurrentFolder", original_folder)
        except Exception:
            pass


def dispatch(resolve, action, args):
    if action == "context":
        return context(resolve)["info"]
    if action == "titleSources":
        return title_sources(resolve)
    if action == "render":
        return render(resolve, args.get("job") or {})
    raise HostError(f"不支持的脚本宿主操作：{action}")


class RpcHandler(BaseHTTPRequestHandler):
    server_version = "AMLLScriptHost/0.4"

    def log_message(self, _format, *_args):
        return

    def do_POST(self):
        host = self.server
        if self.path != "/rpc" or self.headers.get("X-AMLL-Token") != host.token:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise HostError("脚本宿主请求体大小无效")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            data = dispatch(host.resolve, payload.get("action"), payload.get("args") or {})
            response = {"ok": True, "data": data}
            status = 200
        except Exception as error:
            response = {"ok": False, "error": str(error)}
            status = 400
        raw = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    script_dir = Path(__file__).resolve().parent
    app_dir = script_dir if (script_dir / "package.json").is_file() else script_dir / "AMLL-Lyrics-App"
    if not (app_dir / "package.json").is_file():
        raise HostError(f"插件文件不完整：{app_dir}")
    electron = find_electron(script_dir)
    resolve = load_resolve(electron)
    token = secrets.token_urlsafe(32)
    # Serialize requests on the host thread; Resolve API calls must not race in worker threads.
    server = HTTPServer(("127.0.0.1", 0), RpcHandler)
    server.timeout = 0.5
    server.resolve = resolve
    server.token = token
    env = os.environ.copy()
    env["AMLL_SCRIPT_HOST_PORT"] = str(server.server_port)
    env["AMLL_SCRIPT_HOST_TOKEN"] = token
    env["AMLL_SCRIPT_HOST_PARENT_PID"] = str(os.getpid())
    process = subprocess.Popen(
        [str(electron), str(app_dir), "--amll-script-host-port", str(server.server_port), "--amll-script-host-token", token],
        cwd=str(app_dir),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        while process.poll() is None:
            server.handle_request()
    finally:
        server.server_close()
        if process.poll() is None:
            process.terminate()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log_dir = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "AMLL-Lyrics" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(filename=str(log_dir / "host.log"), level=logging.ERROR)
        logging.exception("AMLL host startup failed")
        message = f"AMLL 歌词助手启动失败：{error}\n\n详细日志：{log_dir / 'host.log'}"
        print(message, file=sys.stderr)
        if os.name == "nt":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, "AMLL 歌词助手", 0x10)
        sys.exit(1)
