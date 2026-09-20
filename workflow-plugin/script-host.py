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
import tempfile
import shutil
from contextlib import contextmanager
import threading
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


@contextmanager
def template_directory():
    directory = Path(tempfile.mkdtemp(prefix="amll-title-"))
    try:
        yield directory
    finally:
        # Only clean the exact system-temp leaf this invocation created. Cleanup
        # failure must not turn a successful timeline import into a false failure.
        resolved = directory.resolve()
        if resolved.parent == Path(tempfile.gettempdir()).resolve() and resolved.name.startswith("amll-title-"):
            try:
                shutil.rmtree(resolved)
            except OSError:
                logging.warning("AMLL temporary template cleanup deferred: %s", resolved)


def create_title_seed(scratch, duration_frames, template_path):
    """Bootstrap once; the shared source is never used as the lyrics graph."""
    if call(scratch, "SetMarkInOut", 0, duration_frames - 1, "video") is not True:
        raise HostError("无法设置标题源长度")
    title = call(scratch, "InsertFusionTitleIntoTimeline", "AM Lyrics")
    if title is None or comp_for_item(title) is None:
        raise HostError("无法加载 AM Lyrics 标题，请检查标题安装并重启 Resolve")
    if call(title, "ExportFusionComp", str(template_path), 1) is not True:
        raise HostError("无法导出现有标题节点")
    # The native insertion API cannot select a destination track. A single empty
    # source enables frame/track-addressed AppendToTimeline without per-line wrappers.
    macro = call(comp_for_item(title), "FindTool", "AMLLyrics")
    if macro is None:
        raise HostError("标题中缺少 AMLLyrics 控制器")
    call(macro, "SetInput", "Lyrics", "")
    carrier = call(scratch, "CreateFusionClip", [title])
    seed = call(carrier, "GetMediaPoolItem") if carrier is not None else None
    if seed is None:
        raise HostError("无法建立可复用的 Fusion 定位源")
    call(seed, "SetClipProperty", "Clip Name", "AMLL 标题定位源（共享，不含歌词）")
    return seed


def install_title_graph(item, template_path, line, fps):
    """Each timeline instance owns one independent top-level title composition."""
    previous = values(call(item, "GetFusionCompNameList", default=[]))
    comp = call(item, "ImportFusionComp", str(template_path))
    if comp is None:
        raise HostError("无法将标题节点直接写入时间线片段")
    current = values(call(item, "GetFusionCompNameList", default=[]))
    added = [name for name in current if name not in previous]
    if len(added) != 1 or call(item, "LoadFusionCompByName", added[0]) is None:
        raise HostError("无法确认新标题合成为活动合成")
    # Remove the inherited MediaIn wrapper, rather than leave a second editable
    # composition that still points to a nested title or another lyric instance.
    for name in previous:
        if call(item, "DeleteFusionCompByName", name) is not True:
            raise HostError("无法清除定位源的旧包装合成")
    configure_am_title(item, line, fps)
    call(item, "SetName", as_text(line.get("text"))[:80] or "AM Lyrics")


def render(resolve, job, progress=None):
    if job.get("schemaVersion") != 2 or job.get("kind") != "amll.resolve.render-job":
        raise HostError("渲染任务版本不受支持，请重新生成任务")
    lines = job.get("document", {}).get("lines") or []
    placement = job.get("placement") or {}
    frames = placement.get("lineFrames") or []
    if not lines or len(lines) != len(frames):
        raise HostError("歌词任务行数与帧区间不一致")
    current = context(resolve)
    timeline, project = current["timeline"], current["project"]
    if current["info"]["id"] != as_text(placement.get("timelineId")):
        raise HostError("当前时间线已变化，请刷新连接后重新导入")
    title_source = as_text(job.get("render", {}).get("titleSource", "am-default"))
    if not title_source.startswith("am-"):
        raise HostError("普通脚本模式暂只支持 AM Lyrics 标题来源，请选择 AM Lyrics")
    mode = job.get("render", {}).get("placementMode", "scattered")
    if mode not in ("scattered", "fusion-clip"):
        raise HostError("无效的歌词放置方式")
    rate = placement.get("frameRate") or {}
    numerator, denominator = rate.get("numerator"), rate.get("denominator")
    if not isinstance(numerator, (int, float)) or not isinstance(denominator, (int, float)) or not math.isfinite(numerator) or not math.isfinite(denominator) or numerator <= 0 or denominator <= 0:
        raise HostError("无有效时间线帧率")
    fps = numerator / denominator
    durations = []
    for index, (line, frame) in enumerate(zip(lines, frames)):
        start, end = frame.get("startFrame"), frame.get("endFrameExclusive")
        if type(start) is not int or type(end) is not int or end <= start or start < current["info"]["startFrame"]:
            raise HostError(f"第 {index + 1} 行帧区间无效")
        durations.append(end - start)
        # Validate the final, joined text before adding folders, tracks or clips.
        build_am_inputs(dict(line, _rangeLine=index + 1), fps)

    def report(stage, completed=0):
        if progress is not None:
            try:
                progress({"stage": stage, "completed": completed, "total": len(lines)})
            except Exception:
                pass  # A disconnected progress listener does not cancel a write.

    media_pool = call(project, "GetMediaPool")
    original_folder = call(media_pool, "GetCurrentFolder")
    lanes = assign_track_lanes(frames)
    lane_count = max(lanes) + 1
    inserted, created_tracks = [], []
    scratch, seed, final_item = None, None, None
    with template_directory() as temporary:
        template_path = Path(temporary) / "AM Lyrics.comp"
        try:
            report("正在准备可复用标题源")
            generated_folder = get_or_create_generated_folder(media_pool)
            call(media_pool, "SetCurrentFolder", generated_folder)
            scratch = call(media_pool, "CreateEmptyTimeline", f"AMLL 临时 {int(time.time() * 1000)}")
            if scratch is None or call(project, "SetCurrentTimeline", scratch) is not True:
                raise HostError("无法创建或切换到歌词准备时间线")
            seed = create_title_seed(scratch, max(durations) + 1, template_path)
            if call(project, "SetCurrentTimeline", timeline) is not True:
                raise HostError("无法切回原时间线")
            old_track_count = int(call(timeline, "GetTrackCount", "video", default=0) or 0)
            for lane in range(lane_count):
                if call(timeline, "AddTrack", "video") is not True:
                    raise HostError("无法创建新的顶部视频轨道")
                track_index = old_track_count + lane + 1
                created_tracks.append(track_index)
                call(timeline, "SetTrackName", "video", track_index, TRACK_NAME if lane_count == 1 else f"{TRACK_NAME} {lane + 1}")
            clip_infos = [{"mediaPoolItem": seed, "startFrame": 0, "endFrame": durations[i], "mediaType": 1,
                           "trackIndex": old_track_count + lanes[i] + 1, "recordFrame": frames[i]["startFrame"]}
                          for i in range(len(lines))]
            report("正在批量放置时间线片段")
            inserted = values(call(media_pool, "AppendToTimeline", clip_infos))
            if len(inserted) != len(lines):
                raise HostError(f"只创建了 {len(inserted)}/{len(lines)} 个歌词片段")
            for index, item in enumerate(inserted):
                if call(item, "GetStart") != frames[index]["startFrame"] or call(item, "GetDuration") != durations[index]:
                    raise HostError(f"第 {index + 1} 行位置或长度写入异常")
                install_title_graph(item, template_path, dict(lines[index], _rangeLine=index + 1), fps)
                report("正在写入顶层 Fusion 文字", index + 1)
            if mode == "fusion-clip":
                report("正在创建唯一的外层复合片段", len(lines))
                name = "AMLL " + as_text(job.get("document", {}).get("source", {}).get("title"), "歌词")
                final_item = call(timeline, "CreateCompoundClip", inserted, {"name": name})
                if final_item is None:
                    raise HostError("无法创建汇总复合片段")
                for index in sorted(created_tracks, reverse=True):
                    if not values(call(timeline, "GetItemListInTrack", "video", index)):
                        call(timeline, "DeleteTrack", "video", index)
            report("文字写入完成，正在整理", len(lines))
            return {"insertedCount": 1 if final_item else len(inserted), "sourceLineCount": len(lines),
                    "createdTrackCount": 1 if final_item else lane_count,
                    "timing": job.get("document", {}).get("timing", "line"),
                    "structure": "compound" if final_item else "top-level-fusion",
                    "message": "每句文字均位于自身 Fusion 合成顶层，无逐句歌词嵌套。"}
        except Exception as error:
            try:
                call(project, "SetCurrentTimeline", timeline)
                if final_item is not None:
                    call(timeline, "DeleteClips", [final_item], False)
                elif inserted:
                    call(timeline, "DeleteClips", inserted, False)
                for index in sorted(created_tracks, reverse=True):
                    if not values(call(timeline, "GetItemListInTrack", "video", index)):
                        call(timeline, "DeleteTrack", "video", index)
                if seed is not None:
                    call(media_pool, "DeleteClips", [seed])
            except Exception:
                pass
            raise HostError(f"{error}；已尝试回滚本次新增片段，请检查 AMLL 歌词轨道") from error
        finally:
            try:
                call(project, "SetCurrentTimeline", timeline)
                if scratch is not None:
                    call(media_pool, "DeleteTimelines", [scratch])
                call(media_pool, "SetCurrentFolder", original_folder)
            except Exception:
                pass


def dispatch(resolve, action, args, progress=None):
    if action == "context":
        return context(resolve)["info"]
    if action == "titleSources":
        return title_sources(resolve)
    if action == "render":
        return render(resolve, args.get("job") or {}, progress=progress)
    raise HostError(f"不支持的脚本宿主操作：{action}")


class RpcHandler(BaseHTTPRequestHandler):
    server_version = "AMLLScriptHost/0.4"

    def log_message(self, _format, *_args):
        return

    def stream_render(self, args):
        """Only network heartbeat writes use a thread; all Resolve calls stay serialized."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        stopped, disconnected = threading.Event(), threading.Event()
        lock = threading.Lock()
        started = time.monotonic()

        def emit(message):
            if disconnected.is_set():
                return
            raw = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
            try:
                with lock:
                    self.wfile.write(raw)
                    self.wfile.flush()
            except OSError:
                # A lost client must not turn a completed timeline write into a rollback.
                disconnected.set()

        def heartbeat():
            while not stopped.wait(5):
                emit({"type": "heartbeat", "elapsedSeconds": int(time.monotonic() - started)})

        job = args.get("job") or {}
        document = job.get("document") if isinstance(job, dict) else None
        lines = document.get("lines") if isinstance(document, dict) else None
        emit({"type": "progress", "data": {"stage": "已接收导入任务", "completed": 0,
              "total": len(lines) if isinstance(lines, list) else 0}})
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            data = dispatch(self.server.resolve, "render", args,
                            progress=lambda value: emit({"type": "progress", "data": value}))
            result = {"ok": True, "data": data}
        except Exception as error:
            result = {"ok": False, "error": str(error)}
        finally:
            stopped.set()
            thread.join()
        emit(result)

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
            if not isinstance(payload, dict) or not isinstance(payload.get("args", {}), dict):
                raise HostError("脚本宿主请求格式无效")
            if payload.get("action") == "render":
                self.stream_render(payload.get("args") or {})
                return
            data = dispatch(host.resolve, payload.get("action"), payload.get("args") or {})
            response, status = {"ok": True, "data": data}, 200
        except Exception as error:
            response, status = {"ok": False, "error": str(error)}, 400
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
