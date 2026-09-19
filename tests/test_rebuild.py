"""Regressions for glyph isolation, inspector actions and the Scripts entry."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import build

spec = importlib.util.spec_from_file_location('script_host', ROOT / 'workflow-plugin/script-host.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class RebuildRegressions(unittest.TestCase):
    def test_no_estimated_rectangular_glyph_masks(self):
        source = build.build()
        self.assertFalse('RectangleMask' in source)
        self.assertIn('Start = Input', source)
        self.assertNotIn('count * textSize * 0.55', source)

    def test_buttons_are_owned_by_the_public_macro(self):
        source = build.build()
        self.assertFalse('ResetDefaults = InstanceInput' in source)
        self.assertIn('Restore default', build.build('en'))

    def test_unset_api_env_uses_installed_api_not_working_directory(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(Path, 'is_file', return_value=False):
                with self.assertRaises(host.HostError) as error:
                    host.load_resolve(Path('C:/Resolve/Electron/electron.exe'))
        self.assertIn('Developer', str(error.exception))
        self.assertNotIn('API：Modules', str(error.exception))

    def test_lua_menu_entry_is_packaged(self):
        self.assertTrue((ROOT / 'workflow-plugin/launcher.lua').is_file())
        self.assertIn('launcher.lua', (ROOT / 'Build-Plugin-Package.ps1').read_text('utf-8-sig'))

if __name__ == '__main__':
    unittest.main()
