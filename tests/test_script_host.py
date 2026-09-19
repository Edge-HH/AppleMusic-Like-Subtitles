"""Startup regressions without invoking Resolve writes or opening GUI windows."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('amll_script_host',ROOT/'workflow-plugin/script-host.py')
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

class StartupTests(unittest.TestCase):
    def test_embedded_resolve_is_used_without_external_api(self):
        class Resolve:
            def GetProjectManager(self): return object()
        resolve=Resolve()
        with patch.object(host,'resolve',resolve,create=True):
            self.assertIs(host.load_resolve(Path('/not-installed/electron.exe')),resolve)

    def test_electron_path_hint_accepts_powershell_bom(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);runtime=root/'custom installation'/'electron.exe';runtime.parent.mkdir();runtime.touch()
            (root/'resolve-electron.path').write_text(str(runtime),encoding='utf-8-sig')
            self.assertEqual(host.find_electron(root),runtime)

    def test_blackmagic_loader_can_replace_its_module(self):
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);modules=root/'Modules';modules.mkdir()
            (modules/'DaVinciResolveScript.py').write_text(
                'import sys,types\nsys.modules[__name__]=types.SimpleNamespace(scriptapp=lambda name: "connected")',encoding='utf-8')
            with patch.dict(os.environ,{'RESOLVE_SCRIPT_API':str(root)}):
                with patch.dict(sys.modules):
                    self.assertEqual(host.load_resolve(root/'Electron'/'electron.exe'),'connected')

    def test_background_vocal_parameter_reaches_native_title(self):
        line=dict(text='你好',startMs=0,endMs=1000,words=[],role='background')
        self.assertEqual(host.build_am_inputs(line,24)['BackgroundVocal'],1)
        del line['role']
        self.assertNotIn('BackgroundVocal',host.build_am_inputs(line,24))

    def test_lua_entry_quotes_its_application_path(self):
        from lupa.lua51 import LuaRuntime
        lua=LuaRuntime(unpack_returned_tuples=True)
        lua.execute('''launched=nil;io.open=function(path,mode)
          if path:match('amll%-app.path$') then return {read=function() return 'C:/Test folder/AMLL-Lyrics-App' end,close=function() end} end
          return {close=function() end}
        end
        os.execute=function(command) launched=command end
        debug.getinfo=function() return {source='@C:/Scripts/Utility/AMLL.lua'} end''')
        lua.execute((ROOT/'workflow-plugin/launcher.lua').read_text('utf-8-sig'))
        self.assertIn('-File "C:/Test folder/AMLL-Lyrics-App\\launch.ps1"',lua.globals().launched)
        self.assertIn('-WindowStyle Hidden',lua.globals().launched)

    def test_full_package_contains_entry_and_shared_installer(self):
        source=(ROOT/'Build-Release-Packages.ps1').read_text('utf-8-sig')
        for name in ('launcher.lua','launch.ps1',"'scripts'",'Open-Lyrics.cmd'):
            self.assertIn(name,source)

if __name__=='__main__':unittest.main()
