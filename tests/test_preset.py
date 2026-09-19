"""Validate actual generated Lua, expression boundaries and native-node wiring.

Mocks check serialization and arithmetic, NOT Fusion's renderer or Text+ write-on.
"""
from pathlib import Path
import sys
import unittest
import zipfile

from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build import build, expression


class TimingTests(unittest.TestCase):
    def evaluate(self, result, *, seconds=0, capacity=32, render_start=0, fps=24, **overrides):
        lua = LuaRuntime(unpack_returned_tuples=True)
        fields = dict(Lyrics='我|想要|留住|这一刻', Timings='', Duration=4,
                      Offset=0, FPS=0, Softness=1, OverallOpacity=1)
        fields.update(overrides)
        lua.globals().Controller = lua.table_from(fields, recursive=True)
        lua.execute('comp = {RenderStart = 0}; function comp:GetPrefs(key) return hostFPS end')
        lua.globals().hostFPS = fps
        lua.globals().comp.RenderStart = render_start
        lua.globals().time = render_start + seconds * fps
        return lua.execute(expression(result, capacity)[1:])

    def test_chinese_count_and_remove_delimiters(self):
        self.assertEqual(self.evaluate('count'), 8)
        self.assertEqual(self.evaluate('clean'), '我想要留住这一刻')

    def test_ascii_unicode_and_punctuation(self):
        self.assertEqual(self.evaluate('count', Lyrics='Hey |你，好！'), 8)

    def test_start_midpoint_end(self):
        self.assertEqual(self.evaluate('progress(1)', seconds=-1), 0)
        self.assertEqual(self.evaluate('progress(1)', seconds=0), 0)
        self.assertAlmostEqual(self.evaluate('progress(1)', seconds=0.25), 0.5)
        self.assertEqual(self.evaluate('progress(1)', seconds=0.5), 1)
        self.assertEqual(self.evaluate('progress(8)', seconds=4), 1)
        self.assertEqual(self.evaluate('progress(9)', seconds=4), -1)

    def test_monotonic(self):
        values = [self.evaluate('progress(3)', seconds=i / 100) for i in range(200)]
        self.assertEqual(sorted(values), values)
        self.assertTrue(all(0 <= x <= 1 for x in values))

    def test_manual_segments_and_gap(self):
        timing = '0-1|2-4|4-5|6-9'
        self.assertEqual(self.evaluate('progress(2)', Timings=timing, seconds=1.5), 0)
        self.assertAlmostEqual(self.evaluate('progress(2)', Timings=timing, seconds=2.5), 0.5)
        self.assertEqual(self.evaluate('progress(2)', Timings=timing, seconds=3), 1)
        self.assertEqual(self.evaluate('progress(8)', Timings=timing, seconds=9), 1)

    def test_single_char_segments_give_exact_control(self):
        args = dict(Lyrics='我|爱|你', Timings='0-0.5|0.5-1.5|2-3')
        self.assertAlmostEqual(self.evaluate('progress(2)', seconds=1, **args), 0.5)
        self.assertEqual(self.evaluate('progress(3)', seconds=1.7, **args), 0)

    def test_invalid_timings_use_static_fallback(self):
        for timing in ['0-1', '0-0|1-2|2-3|3-4', '0-2|1-3|3-4|4-5',
                       'wrong|1-2|2-3|3-4', '-1-0|0-1|1-2|2-3', '0-1||2-3|3-4']:
            with self.subTest(timing=timing):
                self.assertFalse(self.evaluate('valid', Timings=timing))
                self.assertEqual(self.evaluate('progress(1)', Timings=timing), -1)
                self.assertIn('STATIC FALLBACK', self.evaluate('status', Timings=timing))

    def test_empty_segments(self):
        for text in ['', '|你', '你|', '你||好']:
            self.assertFalse(self.evaluate('valid', Lyrics=text))

    def test_capacity(self):
        self.assertTrue(self.evaluate('valid', Lyrics='字' * 32))
        self.assertFalse(self.evaluate('valid', Lyrics='字' * 33))
        self.assertEqual(self.evaluate('clean', Lyrics='字' * 33), '字' * 33)
        self.assertTrue(self.evaluate('valid', Lyrics='字' * 64, capacity=64))
        self.assertFalse(self.evaluate('valid', Lyrics='字' * 65, capacity=64))

    def test_offsets_and_composition_start(self):
        self.assertAlmostEqual(self.evaluate('progress(1)', seconds=2.25, Offset=2, render_start=86400), 0.5)
        self.assertEqual(self.evaluate('progress(1)', seconds=0, Offset=-1), 1)

    def test_frame_rates(self):
        for fps in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
            self.assertAlmostEqual(self.evaluate('progress(1)', seconds=0.25, fps=fps), 0.5)
        self.assertAlmostEqual(self.evaluate('progress(1)', seconds=0.25, fps=60, FPS=30), 1)

    def test_crlf_and_whitespace_timing(self):
        self.assertEqual(self.evaluate('clean', Lyrics='你\r\n|好'), '你\n好')
        self.assertTrue(self.evaluate('valid', Timings=' 0-1 | 1-2 | 2-3 | 3-4 '))
        self.assertTrue(self.evaluate('valid', Timings=' \n '))

    def test_styled_text_value(self):
        # Fusion may expose text as a string or a value object.
        self.assertTrue(self.evaluate('valid', Lyrics={'Value': '你好'}))


class PackageTests(unittest.TestCase):
    def parse(self, source):
        lua = LuaRuntime()
        lua.execute('''
          function ordered() return function(t) return t end end
          function wrap(t) return t end
          MacroOperator=wrap; Input=wrap; InstanceInput=wrap; InstanceOutput=wrap
          GroupInfo=wrap; OperatorInfo=wrap; TextPlus=wrap; Merge=wrap; Blur=wrap; FuID=wrap
        ''')
        return lua, lua.execute('return ' + source)

    def test_serialization_all_expressions_and_connections(self):
        for capacity in (32, 64):
            lua, data = self.parse(build(capacity))
            macro = data.Tools.AMLLyrics
            nodes = macro.Tools
            self.assertEqual(len(list(nodes.keys())), 1 + 3 * capacity)
            for name, tool in nodes.items():
                for key, value in tool.Inputs.items():
                    if value.SourceOp:
                        self.assertIn(value.SourceOp, list(nodes.keys()))
                    if value.Expression:
                        expr = value.Expression
                        code = expr[1:] if expr.startswith(':') else 'return ' + expr
                        lua.execute('assert(loadstring(...))', code)
            for key, instance in macro.Inputs.items():
                self.assertIsNotNone(nodes[instance.SourceOp].Inputs[instance.Source])
            self.assertEqual(macro.Outputs.MainOutput1.SourceOp, f'Merge{capacity:02}')
            self.assertTrue(nodes.Glyph01.UserControls.Progress.INP_External)
            self.assertTrue(nodes.Controller.UserControls.Count.INP_External)
            self.assertEqual(nodes.Merge01.Inputs.Background.SourceOp, 'Controller')
            for index in range(2, capacity + 1):
                self.assertEqual(nodes[f'Merge{index:02}'].Inputs.Background.SourceOp, f'Merge{index-1:02}')

    def test_dist_matches_source(self):
        for capacity in (32, 64):
            self.assertEqual((ROOT / 'dist' / f'AM Lyrics {capacity}.setting').read_text('utf8'), build(capacity))

    def test_drfx_layout_and_integrity(self):
        with zipfile.ZipFile(ROOT / 'dist/AM-Lyrics.drfx') as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.namelist()), 2)
            for capacity in (32, 64):
                self.assertEqual(archive.read(f'Edit/Titles/AM Lyrics/AM Lyrics {capacity}.setting').decode(), build(capacity))


if __name__ == '__main__':
    unittest.main()
