"""Validate localized lightweight Fusion title serialization and timing math."""
from pathlib import Path
import sys, unittest, zipfile
from lupa.lua51 import LuaRuntime
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build import build, expression, DEFAULTS, MAX_CHARACTERS

class TimingTests(unittest.TestCase):
    def evaluate(self,result,*,seconds=0,render_start=0,fps=24,**overrides):
        lua=LuaRuntime(unpack_returned_tuples=True)
        fields=dict(Lyrics='我|想要|留住|这一刻',Timings='',Duration=4,Offset=0,FPS=0,Softness=DEFAULTS['Softness'],
                    Size=DEFAULTS['Size'],CharacterSpacing=1,FadeWidth=DEFAULTS['FadeWidth'],Center={'X':0.5,'Y':0.54})
        fields.update(overrides);lua.globals().Controller=lua.table_from(fields,recursive=True)
        lua.execute('comp={RenderStart=0}; function comp:GetPrefs(key) return hostFPS end')
        lua.globals().hostFPS=fps;lua.globals().comp.RenderStart=render_start;lua.globals().time=render_start+seconds*fps
        return lua.execute(expression(result)[1:])
    def test_text_and_unicode_count(self):
        self.assertEqual(self.evaluate('count'),8);self.assertEqual(self.evaluate('clean'),'我想要留住这一刻')
        self.assertEqual(self.evaluate('count',Lyrics='Hey |你，好！'),8)
    def test_per_character_progress(self):
        self.assertEqual(self.evaluate('progress(1)',seconds=0),0)
        self.assertGreater(self.evaluate('progress(1)',seconds=.25),0)
        self.assertEqual(self.evaluate('progress(1)',seconds=.5),1)
    def test_manual_timing_and_gap(self):
        timing='0-1|2-4|4-5|6-9'
        self.assertEqual(self.evaluate('progress(2)',Timings=timing,seconds=1.5),0)
        self.assertGreater(self.evaluate('progress(2)',Timings=timing,seconds=2.5),0)
    def test_sweep_is_monotonic_and_reaches_end(self):
        values=[self.evaluate('sweep',seconds=i/40) for i in range(200)]
        self.assertEqual(values,sorted(values));self.assertEqual(values[-1],1)
    def test_pulse_is_gentle_and_returns_to_zero(self):
        self.assertEqual(self.evaluate('pulse',seconds=0),0)
        self.assertGreater(self.evaluate('pulse',seconds=.2),0)
        self.assertEqual(self.evaluate('pulse',seconds=4.1),0)
    def test_mask_tracks_text_center(self):
        start=self.evaluate('maskCenterX',seconds=0)
        middle=self.evaluate('maskCenterX',seconds=2)
        self.assertLess(start,middle);self.assertTrue(0<self.evaluate('maskWidth',seconds=2)<=1)
    def test_invalid_input_static_fallback(self):
        for timing in ['0-1','0-0|1-2|2-3|3-4','0-2|1-3|3-4|4-5','wrong|1-2|2-3|3-4']:
            self.assertFalse(self.evaluate('valid',Timings=timing));self.assertIn('STATIC FALLBACK',self.evaluate('status',Timings=timing))
    def test_empty_segments_and_limit(self):
        for text in ['', '|你','你|','你||好']: self.assertFalse(self.evaluate('valid',Lyrics=text))
        self.assertTrue(self.evaluate('valid',Lyrics='字'*MAX_CHARACTERS))
        self.assertFalse(self.evaluate('valid',Lyrics='字'*(MAX_CHARACTERS+1)))
    def test_offsets_and_fractional_frame_rates(self):
        self.assertGreater(self.evaluate('sweep',seconds=2.25,Offset=2,render_start=86400),0)
        for fps in (23.976,24,25,29.97,30,50,59.94,60): self.assertGreaterEqual(self.evaluate('sweep',seconds=.25,fps=fps),0)

class PackageTests(unittest.TestCase):
    def parse(self,source):
        lua=LuaRuntime();lua.execute('''
          function ordered() return function(t) return t end end
          function wrap(t) return t end
          MacroOperator=wrap; Input=wrap; InstanceInput=wrap; InstanceOutput=wrap
          GroupInfo=wrap; OperatorInfo=wrap; TextPlus=wrap; Merge=wrap; Blur=wrap
          RectangleMask=wrap; SoftGlow=wrap; Transform=wrap; FuID=wrap
        ''');return lua,lua.execute('return '+source)
    def test_localized_labels_and_control_page(self):
        _,zh=self.parse(build('zh'));_,en=self.parse(build('en'))
        self.assertIn('歌词',zh.Tools.AMLLyrics.Inputs.Lyrics.Name);self.assertIn('Lyrics',en.Tools.AMLLyrics.Inputs.Lyrics.Name)
        self.assertEqual(zh.Tools.AMLLyrics.Inputs.Lyrics.Page,'Controls')
    def test_lightweight_graph_and_connections(self):
        lua,data=self.parse(build('zh'));nodes=data.Tools.AMLLyrics.Tools
        self.assertEqual(len(list(nodes.keys())),8)
        self.assertEqual(data.Tools.AMLLyrics.Outputs.MainOutput1.SourceOp,'FinalMerge')
        self.assertEqual(nodes.ActiveText.Inputs.EffectMask.SourceOp,'KaraokeMask')
        self.assertEqual(nodes.HighlightGlow.Inputs.Input.SourceOp,'ActiveBlur')
        for _,tool in nodes.items():
            for _,value in tool.Inputs.items():
                if value.SourceOp: self.assertIn(value.SourceOp,list(nodes.keys()))
                if value.Expression:
                    code=value.Expression[1:] if value.Expression.startswith(':') else 'return '+value.Expression
                    lua.execute('assert(loadstring(...))',code)
    def test_reset_buttons_exist(self):
        _,data=self.parse(build('zh'));controls=data.Tools.AMLLyrics.Tools.Controller.UserControls
        self.assertEqual(controls.ResetMotion.INPID_InputControl,'ButtonControl')
        self.assertIn('SetInput',controls.ResetLook.BTNCS_Execute)
    def test_dist_matches_source(self):
        for locale in ('zh','en'):
            self.assertEqual((ROOT/'dist'/locale/'AM Lyrics.setting').read_text('utf8'),build(locale))
    def test_localized_drfx(self):
        for locale,label in [('zh','ZH'),('en','EN')]:
            with zipfile.ZipFile(ROOT/'dist'/f'AM-Lyrics-{label}.drfx') as archive:
                self.assertIsNone(archive.testzip());self.assertEqual(archive.namelist(),['Edit/Titles/AM Lyrics/AM Lyrics.setting'])
                self.assertEqual(archive.read(archive.namelist()[0]).decode(),build(locale))
if __name__=='__main__':unittest.main()
