"""Timing, graph, inspector actions and reproducible-package regression tests.

Lua tests do not substitute for Resolve font rendering / performance validation.
"""
from pathlib import Path
import random
import sys
import unittest
import zipfile
from lupa.lua51 import LuaRuntime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build import build, expression, DEFAULTS, MAX_CHARACTERS, SLOT_COUNT


def evaluate(result, seconds=0, render_start=0, fps=24, **overrides):
    lua=LuaRuntime(unpack_returned_tuples=True)
    fields=dict(DEFAULTS, Lyrics='我|想要|留住|这一刻', Timings='')
    fields.update(overrides)
    lua.globals().Controller=lua.table_from(fields,recursive=True)
    lua.execute('comp={RenderStart=0,GlobalStart=0}; function comp:GetPrefs(key) return hostFPS end')
    lua.globals().hostFPS=fps
    lua.globals().comp.GlobalStart=render_start
    lua.globals().comp.RenderStart=render_start+12
    lua.globals().time=render_start+seconds*fps
    return lua.execute(expression(result)[1:])


def parse(source):
    lua=LuaRuntime(unpack_returned_tuples=True)
    lua.execute('''function ordered() return function(t) return t end end
        function wrap(t) return t end
        MacroOperator=wrap;Input=wrap;InstanceInput=wrap;InstanceOutput=wrap
        GroupInfo=wrap;OperatorInfo=wrap;TextPlus=wrap;Merge=wrap;SoftGlow=wrap;Transform=wrap;Custom=wrap''')
    return lua,lua.execute('return '+source)


class TimingTests(unittest.TestCase):
    def test_unicode_and_line_endings(self):
        self.assertEqual(evaluate('count'),8)
        self.assertEqual(evaluate('clean'),'我想要留住这一刻')
        self.assertEqual(evaluate('clean',Lyrics='A\r\nB\rC'),'A\nB\nC')
        self.assertEqual(evaluate('count',Lyrics='Hey |你，好！'),8)

    def test_css_ease_out_solves_bezier_x(self):
        self.assertAlmostEqual(evaluate('bezier(.5,0,0,.58,1)'),.684643,places=4)
        self.assertEqual(evaluate('bezier(0,0,0,.58,1)'),0)
        self.assertEqual(evaluate('bezier(1,0,0,.58,1)'),1)

    def test_word_reveal_uses_word_timing_not_character_count(self):
        result=evaluate('units[1].progress',seconds=.5,Lyrics='Wiiii',Timings='0-2')
        self.assertEqual(result,.25)
        self.assertEqual(evaluate('units[2].progress',seconds=1.5,Lyrics='a|b',Timings='0-1|2-3'),0)

    def test_short_words_float_for_one_second_and_hold(self):
        fields=dict(Lyrics='a|b',Timings='0-.2|.2-.4')
        # Timing grammar deliberately requires 0.2, rather than .2.
        fields['Timings']='0-0.2|0.2-0.4'
        self.assertGreater(evaluate('units[1].lift',seconds=.5,**fields),0)
        self.assertLess(evaluate('units[1].lift',seconds=.5,**fields),.05)
        self.assertEqual(evaluate('units[1].lift',seconds=1.1,**fields),.05)
        self.assertEqual(evaluate('prefix',seconds=1.5,**fields),2)

    def test_emphasis_is_staggered_and_outlives_word_end(self):
        fields=dict(Lyrics='你好|a',Timings='0-2|2-2.3')
        self.assertLess(evaluate('units[1].start',**fields),0)
        self.assertGreater(evaluate('units[2].start-units[1].start',**fields),0)
        self.assertGreater(evaluate('units[2].glow',seconds=1.2,**fields),0)
        self.assertGreater(evaluate('units[1].scale',seconds=1,**fields),1)
        self.assertGreater(evaluate('units[2].lift',seconds=2.1,**fields),.05)
        self.assertAlmostEqual(evaluate('units[2].lift',seconds=4,**fields),.05)
        self.assertEqual(evaluate('units[2].glow',seconds=4,**fields),0)

    def test_english_emphasis_length_gate(self):
        self.assertEqual(evaluate('#units',Lyrics='a',Timings='0-2'),1)
        self.assertEqual(evaluate('units[1].scale',seconds=1,Lyrics='a',Timings='0-2'),1)
        self.assertEqual(evaluate('#units',Lyrics='hello',Timings='0-2'),5)
        self.assertEqual(evaluate('#units',Lyrics='abcdefgh',Timings='0-2'),1)
        self.assertEqual(evaluate('units[1].glow',seconds=1,Lyrics='abcdefgh',Timings='0-2'),0)

    def test_bg_lift_and_last_word_boost(self):
        args=dict(seconds=.3,Lyrics='a',Timings='0-0.5')
        normal=evaluate('units[1].lift',**args)
        self.assertAlmostEqual(evaluate('units[1].lift',BackgroundVocal=1,**args),2*normal)
        args=dict(seconds=.6,Lyrics='你好',Timings='0-2')
        self.assertGreater(evaluate('units[1].glow',**args),evaluate('units[1].glow',LastWordBoost=0,**args))

    def test_no_double_owned_or_missing_characters(self):
        for lyrics in ['我|想要|留住|这一刻','Wii|iii|hello','字'*256,'|'.join('字'*80)]:
            for frame in range(-10,151,3):
                covered=evaluate('''(function()
                    local seen={}
                    for i=1,prefix do seen[i]=(seen[i] or 0)+1 end
                    for _,u in pairs(slots) do for i=u.index,u.last do seen[i]=(seen[i] or 0)+1 end end
                    for i=last+1,count do seen[i]=(seen[i] or 0)+1 end
                    for i=1,count do if seen[i]~=1 then return false end end
                    for i=1,prefix do
                        for _,u in ipairs(units) do if i>=u.index and i<=u.last and u.progress<1 then return false end end
                    end
                    return true
                end)()''',seconds=frame/24,Lyrics=lyrics)
                self.assertTrue(covered,(lyrics[:20],frame))

    def test_backward_seeks_and_fractional_frame_rates(self):
        for fps in (23.976,24,25,29.97,30,50,59.94,60):
            for seconds in (4,1.25,0,3,1.25):
                self.assertEqual(evaluate('state',seconds=seconds,fps=fps),evaluate('state',seconds=seconds+2,Offset=2,render_start=86400,fps=fps))

    def test_invalid_time_is_static_without_losing_text(self):
        for timing in ['0-1','0-0|1-2|2-3|3-4','0-2|1-3|3-4|4-5','wrong|1-2|2-3|3-4']:
            self.assertFalse(evaluate('valid',Timings=timing))
            self.assertEqual(evaluate('prefix',Timings=timing),8)
            self.assertIn('STATIC FALLBACK',evaluate('status',Timings=timing))
        for lyrics in ('','|你','你|','你||好','字'*257): self.assertFalse(evaluate('valid',Lyrics=lyrics))
        self.assertTrue(evaluate('valid',Lyrics='字'*MAX_CHARACTERS))


class PackageTests(unittest.TestCase):
    def test_graph_native_types_and_dependencies(self):
        lua,data=parse(build());nodes=data.Tools.AMLLyrics.Tools
        self.assertEqual(len(list(nodes.keys())),4+6*SLOT_COUNT)
        for _,tool in nodes.items():
            for _,value in tool.Inputs.items():
                if value.SourceOp: self.assertIn(value.SourceOp,list(nodes.keys()))
                if value.Expression:
                    script=value.Expression[1:] if value.Expression.startswith(':') else 'return '+value.Expression
                    lua.execute('assert(loadstring(...))',script)
        self.assertEqual(nodes.Glyph01.Inputs.End.Expression,'Controller.S01End/max(1,Controller.Count)')
        self.assertIn('WordBounds01.Output.DataWindow',nodes.Reveal01.Inputs.NumberIn2.Expression)
        self.assertIn('Controller.S01Glow',nodes.Glow01.Inputs.Blend.Expression)
        self.assertEqual(nodes.Reveal01.Inputs.AlphaExpression.Value,'a1*i1*n7')

    def test_state_serialization_matches_all_native_fields(self):
        lua,data=parse(build());controller=data.Tools.AMLLyrics.Tools.Controller
        state=evaluate('state',seconds=1.2)
        lua.globals().Controller=lua.table_from({'State':{'Value':state}},recursive=True)
        for slot,row in enumerate(state.split(';')[1:1+SLOT_COUNT],1):
            for field,expected in zip(('Index','End','WordFirst','WordLast','Progress','Lift','Scale','Shift','Glow','Radius'),row.split(',')):
                result=lua.execute(controller.Inputs[f'S{slot:02}{field}'].Expression[1:])
                self.assertAlmostEqual(result,float(expected))

    def test_visible_buttons_and_meaningful_controls(self):
        for locale in ('zh','en'):
            _,data=parse(build(locale));macro=data.Tools.AMLLyrics
            self.assertEqual(macro.UserControls.ResetDefaults.INPID_InputControl,'ButtonControl')
            self.assertEqual(macro.UserControls.SetSegment.INPID_InputControl,'ButtonControl')
            for removed in ('Softness','IdleBrightness','IdleBlur','ActiveBlur','SegmentCharacters','StartPosition','EndPosition'):
                self.assertIsNone(macro.Inputs[removed])
            for key in ('Font','Style','Size','Center','FloatHeight','Glow','SegmentStart','SegmentEnd'):
                self.assertIsNotNone(macro.Inputs[key])

    def action(self, name, values):
        lua,data=parse(build());lua.globals().inputs=lua.table_from(values,recursive=True)
        lua.execute('''tool={};function tool:GetInput(k) return inputs[k] end
            function tool:SetInput(k,v) inputs[k]=v end''')
        lua.execute(data.Tools.AMLLyrics.UserControls[name].BTNCS_Execute)
        return lua.globals().inputs

    def test_reset_preserves_lyrics_and_schedule(self):
        values=dict(DEFAULTS,Lyrics='你好',Timings='0-3',Duration=9,Offset=3,FPS=60,Glow=2,Font='Other',Size=.2,SegmentStart=2,SegmentEnd=2)
        result=self.action('ResetDefaults',values)
        for key in ('Lyrics','Timings','Duration','Offset','FPS','SegmentStart','SegmentEnd'): self.assertEqual(result[key],values[key])
        for key in ('Glow','Size','FloatHeight','IdleOpacity','ActiveOpacity'): self.assertEqual(result[key],DEFAULTS[key])
        self.assertEqual(result.Font,'Microsoft YaHei UI')
        self.assertEqual(result.Center[1],.5)

    def test_split_preserves_existing_timing_and_gaps(self):
        result=self.action('SetSegment',dict(Lyrics='abc|def',Timings='0-3|5-8',SegmentStart=2,SegmentEnd=5))
        self.assertEqual(result.Lyrics,'a|bc|de|f')
        self.assertEqual(result.Timings,'0.000000000-1.000000000|1.000000000-3.000000000|5.000000000-7.000000000|7.000000000-8.000000000')
        self.assertTrue(evaluate('valid',Lyrics=result.Lyrics,Timings=result.Timings))

    def test_invalid_selection_does_not_mutate_lyrics_or_timing(self):
        for a,b in ((0,1),(3,2),(1,8),(1.5,2)):
            result=self.action('SetSegment',dict(Lyrics='你|好',Timings='0-1|2-3',SegmentStart=a,SegmentEnd=b))
            self.assertEqual(result.Lyrics,'你|好');self.assertEqual(result.Timings,'0-1|2-3')
            self.assertIn('Invalid',result.SegmentStatus)

    def test_unicode_selection_accepts_number_wrappers(self):
        result=self.action('SetSegment',dict(Lyrics='我想要留住',Timings='',SegmentStart={'Value':2},SegmentEnd={'Value':3}))
        self.assertEqual(result.Lyrics,'我|想要|留住')
        self.assertIn('想要',result.SegmentStatus)

    def test_dist_matches_source_and_archive_crc(self):
        for locale,label in [('zh','ZH'),('en','EN')]:
            self.assertEqual((ROOT/'dist'/locale/'AM Lyrics.setting').read_text('utf8'),build(locale))
            with zipfile.ZipFile(ROOT/'dist'/f'AM-Lyrics-{label}.drfx') as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.namelist(),['Edit/Titles/AM Lyrics/AM Lyrics.setting'])
                self.assertEqual(archive.read(archive.namelist()[0]).decode('utf8'),build(locale))

if __name__=='__main__': unittest.main()
