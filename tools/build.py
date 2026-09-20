"""Generate a native Fusion glyph renderer with bounded, persistent motion slots."""
from pathlib import Path
import argparse
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (ROOT / 'src/timing.lua').read_text(encoding='utf-8-sig')
MAX_CHARACTERS = 256
SLOT_COUNT = 16
DEFAULTS = dict(Duration=4, Offset=0, FPS=0, FadeWidth=.5, IdleOpacity=.4,
                ActiveOpacity=1, OverallOpacity=1, FloatHeight=.05, FloatDuration=1,
                Emphasis=1, EmphasisDuration=1, Glow=1, LastWordBoost=1, BackgroundVocal=0,
                Size=.075, CharacterSpacing=1, LineSpacing=1, Red1=1, Green1=1, Blue1=1,
                WeightBoost=.006, EnableSweep=1, EnableFloat=1, EnableEmphasis=1, EnableStagger=1, EnableGlow=1)
LABELS = {
    'zh': dict(Lyrics='歌词（用 | 分词）', Timings='分词时间（开始-结束秒，可留空）', Duration='自动唱完秒数',
        Offset='整体延后秒数', FPS='帧率（0 跟随合成）', WeightBoost='字形加厚（0 关闭）',
        EnableSweep='启用平滑扫亮', EnableFloat='启用上浮', EnableEmphasis='启用长音强调',
        EnableStagger='启用逐字错落（较耗性能）', EnableGlow='启用强调光晕（较耗性能）',
        Status='时间／容量检查', ResetDefaults='恢复默认效果（保留歌词和时间）',
        Font='字体', Style='字重', Size='字号', Center='位置', CharacterSpacing='字距', LineSpacing='行距',
        Red1='文字颜色', Green1='文字颜色', Blue1='文字颜色', OverallOpacity='总透明度',
        FadeWidth='亮暗前沿宽度（em）', IdleOpacity='未唱透明度', ActiveOpacity='已唱透明度',
        FloatHeight='常规上浮高度（em）', FloatDuration='最短上浮时长（秒）', Emphasis='长音强调倍率',
        EmphasisDuration='长音强调门槛（秒）', Glow='强调光晕倍率', LastWordBoost='加强句尾长音',
        BackgroundVocal='背景人声（上浮加倍）'),
    'en': dict(Lyrics='Lyrics (separate words with |)', Timings='Word times (start-end seconds, optional)',
        Duration='Auto duration (seconds)', Offset='Global delay (seconds)', FPS='FPS (0 follows composition)',
        WeightBoost='Extra weight (0 disables)', EnableSweep='Smooth reveal', EnableFloat='Float motion',
        EnableEmphasis='Sustained-word emphasis', EnableStagger='Per-character stagger (costly)',
        EnableGlow='Emphasis glow (costly)', Status='Timing / capacity status',
        ResetDefaults='Restore default effect (keep lyrics and timing)', Font='Font', Style='Weight', Size='Size',
        Center='Position', CharacterSpacing='Tracking', LineSpacing='Line spacing', Red1='Text color',
        Green1='Text color', Blue1='Text color', OverallOpacity='Overall opacity', FadeWidth='Reveal edge width (em)',
        IdleOpacity='Unplayed opacity', ActiveOpacity='Played opacity', FloatHeight='Normal lift (em)',
        FloatDuration='Minimum float duration (seconds)', Emphasis='Sustained-word emphasis multiplier',
        EmphasisDuration='Emphasis threshold (seconds)', Glow='Emphasis glow multiplier',
        LastWordBoost='Boost final sustained word', BackgroundVocal='Background vocal (double lift)'),
}


def quote(value):
    return json.dumps(value, ensure_ascii=False)


def literal(value):
    if isinstance(value, str): return quote(value)
    if isinstance(value, bool): return str(value).lower()
    if isinstance(value, (list, tuple)): return '{' + ', '.join(map(literal, value)) + '}'
    return str(value)


def inp(value=None, expression=None, source=None, output='Output'):
    if source: return f'Input {{ SourceOp = "{source}", Source = "{output}", }}'
    parts = []
    if value is not None: parts.append('Value = ' + literal(value))
    if expression is not None: parts.append('Expression = ' + quote(expression))
    return 'Input { ' + ', '.join(parts) + ', }'


def expression(result):
    return f':local MAX_CHARACTERS={MAX_CHARACTERS}; local SLOT_COUNT={SLOT_COUNT}\n' + RUNTIME + '\nreturn ' + result


def state_field(row, column):
    # Evaluate timing once (Controller.State), not separately for every glyph property.
    prefix = '[^;]*;' * row
    return (':local s=Controller.State; if type(s)~="string" then s=s.Value end; '
            f'local r=s:match("^{prefix}([^;]*)"); '
            f'return tonumber(r and r:match("^{"[^,]*," * (column-1)}([^,]*)")) or 0')


def user_control(label, kind='Number', default=0, minimum=0, maximum=1, readonly=False,
                 button_script=None, integer=False, page='Controls', checkbox=False):
    values = dict(LINKS_Name=label, LINKID_DataType=kind, ICS_ControlPage=page, INP_External=True)
    if button_script is not None:
        values.update(INPID_InputControl='ButtonControl', BTNCS_Execute=button_script)
    elif kind == 'Text':
        values.update(INPID_InputControl='TextEditControl', TEC_Lines=1 if readonly else 3,
                      TEC_Wrap=True, TEC_ReadOnly=readonly)
    else:
        values.update(INPID_InputControl='CheckboxControl' if checkbox else 'SliderControl',
                      INP_Default=default, INP_MinScale=minimum, INP_MaxScale=maximum,
                      INP_MinAllowed=minimum, INP_MaxAllowed=maximum, INP_Integer=integer)
    return '{ ' + ', '.join(k + ' = ' + literal(v) for k, v in values.items()) + ', }'


def node(name, kind, inputs, controls=None, x=0, y=0):
    result = f'        {name} = {kind} {{\n          Inputs = {{\n'
    result += ',\n'.join('            ' + k + ' = ' + v for k, v in inputs.items()) + ',\n          },\n'
    if controls:
        result += '          UserControls = ordered() {\n' + ',\n'.join('            ' + k + ' = ' + v for k, v in controls.items()) + ',\n          },\n'
    return result + f'          ViewInfo = OperatorInfo {{ Pos = {{ {x}, {y} }} }},\n        }}'


def reset_script(keys=None, font='Microsoft YaHei UI', style='Bold'):
    keys = keys or [k for k in DEFAULTS if k not in ('Duration', 'Offset', 'FPS')]
    values = {k: DEFAULTS[k] for k in keys}
    values.update(Font=font, Style=style, Center=[.5, .54])
    # Buttons live on the public macro, so `tool` is the same object users edit.
    statements = ['local c=comp; if c then c:StartUndo("Restore lyric appearance") end']
    for key, value in values.items():
        statements.append(f'local input=tool[{quote(key)}]; if input then input:SetExpression(nil); input:ConnectTo(nil) end; tool:SetInput({quote(key)}, {literal(value)})')
    statements.append('if c then c:EndUndo(true) end')
    return '\n'.join(statements)


def build(locale='zh', lyrics='我|想要|留住|这一刻', timings='', font=None, style='Bold'):
    labels = LABELS[locale]
    font = font or ('Microsoft YaHei UI' if locale == 'zh' else 'Arial')
    control_keys = ['Lyrics', 'Timings', 'Duration', 'Offset', 'FPS', 'Status']
    motion_keys = ['EnableSweep','EnableFloat','EnableEmphasis','EnableStagger','EnableGlow','FadeWidth','IdleOpacity','ActiveOpacity','FloatHeight','FloatDuration','Emphasis','EmphasisDuration','Glow','LastWordBoost','BackgroundVocal']
    style_keys = ['Font','Style','WeightBoost','Size','Center','CharacterSpacing','LineSpacing','Red1','Green1','Blue1','OverallOpacity']
    limits = dict(Duration=(.01,120), Offset=(-120,120), FPS=(0,240), WeightBoost=(0,.02),
                  FadeWidth=(.02,1), FloatHeight=(0,.15), FloatDuration=(.1,3), Emphasis=(0,2),
                  EmphasisDuration=(.5,4), Glow=(0,2))
    controls, ctrl = {}, {}
    for key in control_keys + motion_keys + ['OverallOpacity','WeightBoost']:
        if key in ('Lyrics','Timings','Status'):
            value = lyrics if key == 'Lyrics' else timings if key == 'Timings' else ''
            ctrl[key] = inp(value)
            controls[key] = user_control(labels[key], 'Text', readonly=key == 'Status')
        else:
            lo,hi = limits.get(key,(0,1))
            ctrl[key] = inp(DEFAULTS[key])
            controls[key] = user_control(labels[key],default=DEFAULTS[key],minimum=lo,maximum=hi,
                checkbox=key.startswith('Enable') or key in ('LastWordBoost','BackgroundVocal'),
                page='Motion' if key in motion_keys else 'Style' if key in style_keys else 'Controls')
    controls['State'] = user_control('Internal timeline state', 'Text', readonly=True, page='Internal')
    ctrl['State'] = inp(expression=expression('state'))
    controls['FrameAspect'] = user_control('Internal frame aspect',maximum=10,page='Internal')
    ctrl['FrameAspect'] = inp(expression='comp:GetPrefs("Comp.FrameFormat.Width")/max(1,comp:GetPrefs("Comp.FrameFormat.Height"))')
    ctrl['Status'] = inp(expression=':local s=Controller.State; if type(s)~="string" then s=s.Value end; return s:match("([^;]*)$")')
    for key,col in [('Prefix',1),('Last',2),('Count',3)]:
        controls[key]=user_control(key,maximum=256,page='Internal');ctrl[key]=inp(expression=state_field(0,col))
    for slot in range(1,SLOT_COUNT+1):
        for col,field in enumerate(('Index','End','WordFirst','WordLast','Progress','Lift','Scale','Shift','Glow','Radius'),1):
            key=f'S{slot:02}{field}'
            controls[key]=user_control(key,minimum=-256,maximum=256,page='Internal')
            ctrl[key]=inp(expression=state_field(slot,col))
    ctrl.update(StyledText=inp(expression=':local s=Controller.Lyrics; if type(s)~="string" then s=s.Value end; return s:gsub("|", ""):gsub("\\r\\n", "\\n"):gsub("\\r", "\\n")'),
        Font=inp(font), Style=inp(style), Center=inp([.5,.54]), Size=inp(DEFAULTS['Size']),
        CharacterSpacing=inp(1), LineSpacing=inp(1), Red1=inp(1), Green1=inp(1), Blue1=inp(1),
        Opacity1=inp(0),UseFrameFormatSettings=inp(1),Width=inp(1920),Height=inp(1080))
    common = dict(StyledText=inp(expression='Controller.StyledText'),Font=inp(expression='Controller.Font'),
        Style=inp(expression='Controller.Style'),Size=inp(expression='Controller.Size'),Center=inp(expression='Controller.Center'),
        CharacterSpacing=inp(expression='Controller.CharacterSpacing'),LineSpacing=inp(expression='Controller.LineSpacing'),
        Red1=inp(expression='Controller.Red1'),Green1=inp(expression='Controller.Green1'),Blue1=inp(expression='Controller.Blue1'),
        UseFrameFormatSettings=inp(1),Width=inp(1920),Height=inp(1080),HorizontalJustificationNew=inp(3),VerticalJustificationNew=inp(3))
    common.update(Enabled2=inp(expression='iif(Controller.WeightBoost>0,1,0)'),
        ElementShape2=inp(1), Thickness2=inp(expression='Controller.WeightBoost'),
        Red2=inp(expression='Controller.Red1'),Green2=inp(expression='Controller.Green1'),
        Blue2=inp(expression='Controller.Blue1'),Opacity2=inp(1))
    prefix = dict(common,Start=inp(0),End=inp(expression='Controller.Prefix/max(1,Controller.Count)'),
        Opacity1=inp(expression='iif(Controller.Prefix>0,Controller.ActiveOpacity*Controller.OverallOpacity,0)'),
        Center=inp(expression='Point(Controller.Center.X,Controller.Center.Y+Controller.EnableFloat*Controller.FloatHeight*Controller.Size*Controller.FrameAspect*iif(Controller.BackgroundVocal>.5,2,1))'))
    future = dict(common,Start=inp(expression='Controller.Last/max(1,Controller.Count)'),End=inp(1),
        Opacity1=inp(expression='iif(Controller.Last<Controller.Count,Controller.IdleOpacity*Controller.OverallOpacity,0)'))
    prefix['Opacity2']=prefix['Opacity1'];future['Opacity2']=future['Opacity1']
    nodes=[node('Controller','TextPlus',ctrl,controls),node('SettledText','TextPlus',prefix,x=200,y=-80),node('FutureText','TextPlus',future,x=200,y=-160),
           node('StaticMerge','Merge',dict(Background=inp(source='FutureText'),Foreground=inp(source='SettledText'),PerformDepthMerge=inp(0)),x=400,y=-80)]
    previous='StaticMerge'
    for slot in range(1,SLOT_COUNT+1):
        key=f'S{slot:02}'; glyph=f'Glyph{slot:02}'; shade=f'Reveal{slot:02}'; move=f'Motion{slot:02}'; glow=f'Glow{slot:02}'; merge=f'Merge{slot:02}'
        idx=f'Controller.{key}Index'
        inputs=dict(common,StyledText=inp(expression=f'iif({idx}>0,Controller.StyledText,"")'),
                    Start=inp(expression=f'max(0,{idx}-1)/max(1,Controller.Count)'),End=inp(expression=f'Controller.{key}End/max(1,Controller.Count)'),Opacity1=inp(1))
        nodes.append(node(glyph,'TextPlus',inputs,x=200,y=slot*80))
        word=f'WordBounds{slot:02}'
        measurement=dict(inputs,Start=inp(expression=f'max(0,Controller.{key}WordFirst-1)/max(1,Controller.Count)'),
                         End=inp(expression=f'Controller.{key}WordLast/max(1,Controller.Count)'))
        nodes.append(node(word,'TextPlus',measurement,x=100,y=slot*80))
        def bound(index):
            # Avoid a second Text+ raster for whole-word slots and completed/disabled sweeps.
            # Emphasized characters of the same word share the first slot's measurement.
            shared = ''
            if slot > 1:
                prev=f'S{slot-1:02}'
                shared=(f'if Controller.{prev}WordFirst==Controller.{key}WordFirst then '
                        f'return Reveal{slot-1:02}.NumberIn{2 if index == 1 else 3} end; ')
            return (f':if Controller.{key}Progress<=0 or Controller.{key}Progress>=1 or Controller.EnableSweep<.5 then return 0 end; '
                    + shared + f'local image; if {idx}==Controller.{key}WordFirst and Controller.{key}End==Controller.{key}WordLast '
                    f'then image={glyph}.Output else image={word}.Output end; '
                    f'local d=image.DataWindow; if not d or d[1]<-10000 then return 0 end; return d[{index}]/image.Width')
        reveal=dict(Image1=inp(source=glyph),NumberIn1=inp(expression=f'Controller.{key}Progress'),
                    NumberIn2=inp(expression=bound(1)),NumberIn3=inp(expression=bound(3)),
                    NumberIn4=inp(expression='max(.000001,Controller.FadeWidth*Controller.Size)'),
                    NumberIn5=inp(expression='Controller.IdleOpacity'),NumberIn6=inp(expression='Controller.ActiveOpacity'),
                    NumberIn7=inp(expression='Controller.OverallOpacity'),NumberIn8=inp(expression='Controller.EnableSweep'),
                    Intermediate1=inp('if(n1<=0,n5,if(n1>=1,n6,if(n8<0.5,n5,n5+(n6-n5)*min(1,max(0,(n2+n1*(max(0,n3-n2)+n4)-x)/n4)))))'))
        for channel,source in [('RedExpression','r1'),('GreenExpression','g1'),('BlueExpression','b1'),('AlphaExpression','a1')]:
            reveal[channel]=inp(f'{source}*i1*n7')
        nodes.append(node(shade,'Custom',reveal,x=400,y=slot*80))
        pivot=f':if Controller.{key}Scale==1 then return Point(.5,.5) end; local d={glyph}.Output.DataWindow; if not d or d[1]<-10000 then return Point(.5,.5) end; return Point((d[1]+d[3])/2/{glyph}.Output.Width,(d[2]+d[4])/2/{glyph}.Output.Height)'
        nodes.append(node(move,'Transform',dict(Input=inp(source=shade),Blend=inp(expression=f'iif(Controller.{key}Scale==1 and Controller.{key}Shift==0 and Controller.{key}Lift==0,0,1)'),Pivot=inp(expression=pivot),Size=inp(expression=f'Controller.{key}Scale'),
            Center=inp(expression=f'Point(.5+Controller.{key}Shift*Controller.Size,.5+Controller.{key}Lift*Controller.Size*Controller.FrameAspect)'),Edges=inp(0)),x=600,y=slot*80))
        nodes.append(node(glow,'SoftGlow',dict(Input=inp(source=move),Gain=inp(expression=f'Controller.{key}Glow'),
            XGlowSize=inp(expression=f'Controller.{key}Radius*Controller.Size*100'),YGlowSize=inp(expression=f'Controller.{key}Radius*Controller.Size*100'),
            Blend=inp(expression=f'iif(Controller.{key}Glow>0,1,0)')),x=800,y=slot*80))
        nodes.append(node(merge,'Merge',dict(Background=inp(source=previous),Foreground=inp(source=glow),
            Blend=inp(expression=f'iif({idx}>0,1,0)'),PerformDepthMerge=inp(0)),x=1000,y=slot*80));previous=merge
    exposed=[]
    for keys,page in [(control_keys,'Controls'),(style_keys,'Style'),(motion_keys,'Motion')]:
        for key in keys:
            group=' ControlGroup = 1,' if key in ('Font','Style') else ' ControlGroup = 2,' if key in ('Red1','Green1','Blue1') else ''
            exposed.append(f'        {key} = InstanceInput {{ SourceOp = "Controller", Source = "{key}", Name = {quote(labels[key])}, Page = "{page}",{group} }}')
    buttons=dict(ResetDefaults=user_control(labels['ResetDefaults'],button_script=reset_script(font=font,style=style)))
    for key in buttons: exposed.append(f'        {key} = {inp(0)}')
    return '{\n  Tools = ordered() {\n    AMLLyrics = MacroOperator {\n      Inputs = ordered() {\n'+',\n'.join(exposed)+'\n      },\n'+f'      Outputs = {{ MainOutput1 = InstanceOutput {{ SourceOp = "{previous}", Source = "Output", }} }},\n'+ '      UserControls = ordered() {\n'+',\n'.join('        '+k+' = '+v for k,v in buttons.items())+'\n      },\n      ViewInfo = GroupInfo { Pos = { 0, 0 } },\n      Tools = ordered() {\n'+',\n'.join(nodes)+'\n      },\n    },\n  },\n  ActiveTool = "AMLLyrics",\n}\n'


def write_zip(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name,data in sorted(entries.items()):
            info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'dist');args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    for locale,label in [('zh','ZH'),('en','EN')]:
        data=build(locale).encode('utf-8');folder=args.output/locale;folder.mkdir(parents=True,exist_ok=True)
        (folder/'AM Lyrics.setting').write_bytes(data)
        write_zip(args.output/f'AM-Lyrics-{label}.drfx',{'Edit/Titles/AM Lyrics/AM Lyrics.setting':data})
    print(f'Built localized titles in {args.output}')

if __name__=='__main__': main()
