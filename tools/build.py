"""Build a lightweight localized Fusion title with Apple Music-inspired motion."""
from pathlib import Path
import argparse
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (ROOT / 'src/timing.lua').read_text(encoding='utf-8-sig')
MAX_CHARACTERS = 256

LABELS = {
    'zh': {
        'lyrics': '歌词（用 | 分段）', 'timings': '逐字时间（开始-结束秒）', 'duration': '自动唱完秒数',
        'offset': '整体延后秒数', 'softness': '高亮过渡柔和度', 'fps': '帧率（0 为合成帧率）',
        'fade': '单字内渐变宽度', 'bounce': '轻微跳动强度', 'bounce_height': '上浮幅度',
        'idle_opacity': '未唱透明度', 'active_opacity': '已唱透明度', 'idle_brightness': '未唱亮度',
        'idle_blur': '未唱模糊', 'active_blur': '已唱模糊', 'glow_gain': '高亮炫光强度',
        'glow_size': '高亮炫光大小', 'overall': '总透明度', 'status': '输入检查',
        'font': '字体', 'style': '字重', 'size': '字号', 'position': '位置', 'tracking': '字距',
        'line_spacing': '行距', 'color': '高亮颜色', 'reset_motion': '重置动画参数', 'reset_look': '重置样式参数',
    },
    'en': {
        'lyrics': 'Lyrics (separate words with |)', 'timings': 'Word timings (start-end seconds)', 'duration': 'Auto duration (seconds)',
        'offset': 'Global delay (seconds)', 'softness': 'Highlight transition softness', 'fps': 'FPS (0 uses composition rate)',
        'fade': 'In-word gradient width', 'bounce': 'Gentle bounce amount', 'bounce_height': 'Lift amount',
        'idle_opacity': 'Unplayed opacity', 'active_opacity': 'Played opacity', 'idle_brightness': 'Unplayed brightness',
        'idle_blur': 'Unplayed blur', 'active_blur': 'Played blur', 'glow_gain': 'Highlight glow gain',
        'glow_size': 'Highlight glow size', 'overall': 'Overall opacity', 'status': 'Input status',
        'font': 'Font', 'style': 'Weight', 'size': 'Size', 'position': 'Position', 'tracking': 'Tracking',
        'line_spacing': 'Line spacing', 'color': 'Highlight color', 'reset_motion': 'Reset motion', 'reset_look': 'Reset appearance',
    },
}

DEFAULTS = {
    'Duration': 4, 'Offset': 0, 'Softness': 0.72, 'FPS': 0, 'FadeWidth': 0.035,
    'BounceAmount': 0.035, 'BounceHeight': 0.012, 'IdleOpacity': 0.28, 'ActiveOpacity': 1,
    'IdleBrightness': 0.52, 'IdleBlur': 0.75, 'ActiveBlur': 0, 'GlowGain': 1.35,
    'GlowSize': 4.5, 'OverallOpacity': 1, 'Size': 0.075, 'CharacterSpacing': 1,
    'LineSpacing': 1, 'Red1': 0.97, 'Green1': 0.98, 'Blue1': 1,
}


def quote(value): return json.dumps(value, ensure_ascii=False)
def literal(value):
    if isinstance(value, str): return quote(value)
    return str(value).lower() if isinstance(value, bool) else str(value)

def inp(value=None, expression=None, source=None, output='Output'):
    if source: return f'Input {{ SourceOp = "{source}", Source = "{output}", }}'
    parts = []
    if value is not None: parts.append(f'Value = {literal(value)}')
    if expression is not None: parts.append(f'Expression = {quote(expression)}')
    return 'Input { ' + ', '.join(parts) + ', }'

def expression(result): return ':local MAX_CHARACTERS = ' + str(MAX_CHARACTERS) + '\n' + RUNTIME + '\nreturn ' + result

def user_control(label, kind='Number', default=0, minimum=0, maximum=1, readonly=False, button_script=None):
    values = {'LINKS_Name': label, 'LINKID_DataType': kind, 'ICS_ControlPage': 'Controls', 'INP_External': True}
    if button_script is not None:
        values.update(INPID_InputControl='ButtonControl', BTNCS_Execute=button_script)
    elif kind == 'Text':
        values.update(INPID_InputControl='TextEditControl', TEC_Lines=2 if not readonly else 1, TEC_Wrap=True, TEC_ReadOnly=readonly)
    else:
        values.update(INPID_InputControl='SliderControl', INP_Default=default, INP_MinScale=minimum,
                      INP_MaxScale=maximum, INP_MinAllowed=minimum, INP_MaxAllowed=maximum, INP_Integer=False)
    return '{ ' + ', '.join(k + ' = ' + literal(v) for k, v in values.items()) + ', }'

def node(name, node_type, inputs, controls=None, x=0, y=0):
    body = ',\n'.join('            ' + key + ' = ' + value for key, value in inputs.items())
    result = f'''        {name} = {node_type} {{
          Inputs = {{
{body},
          }},
          ViewInfo = OperatorInfo {{ Pos = {{ {x}, {y} }} }},
'''
    if controls:
        result += '          UserControls = ordered() {\n' + ',\n'.join('            ' + k + ' = ' + v for k, v in controls.items()) + ',\n          },\n'
    return result + '        }'

def reset_script(keys):
    return '; '.join(f'tool:SetInput({quote(key)}, {literal(DEFAULTS[key])})' for key in keys)

def build(locale='zh', lyrics='我|想要|留住|这一刻', timings='', font=None, style='Bold'):
    labels = LABELS[locale]
    font = font or ('Microsoft YaHei UI' if locale == 'zh' else 'Arial')
    params = [
        ('Lyrics', labels['lyrics'], 'Text', lyrics, 0, 1), ('Timings', labels['timings'], 'Text', timings, 0, 1),
        ('Duration', labels['duration'], 'Number', DEFAULTS['Duration'], 0.01, 120),
        ('Offset', labels['offset'], 'Number', DEFAULTS['Offset'], -120, 120),
        ('Softness', labels['softness'], 'Number', DEFAULTS['Softness'], 0.05, 1),
        ('FPS', labels['fps'], 'Number', DEFAULTS['FPS'], 0, 240),
        ('FadeWidth', labels['fade'], 'Number', DEFAULTS['FadeWidth'], 0.001, 0.25),
        ('BounceAmount', labels['bounce'], 'Number', DEFAULTS['BounceAmount'], 0, 0.12),
        ('BounceHeight', labels['bounce_height'], 'Number', DEFAULTS['BounceHeight'], 0, 0.05),
        ('IdleOpacity', labels['idle_opacity'], 'Number', DEFAULTS['IdleOpacity'], 0, 1),
        ('ActiveOpacity', labels['active_opacity'], 'Number', DEFAULTS['ActiveOpacity'], 0, 1),
        ('IdleBrightness', labels['idle_brightness'], 'Number', DEFAULTS['IdleBrightness'], 0, 1),
        ('IdleBlur', labels['idle_blur'], 'Number', DEFAULTS['IdleBlur'], 0, 10),
        ('ActiveBlur', labels['active_blur'], 'Number', DEFAULTS['ActiveBlur'], 0, 10),
        ('GlowGain', labels['glow_gain'], 'Number', DEFAULTS['GlowGain'], 0, 4),
        ('GlowSize', labels['glow_size'], 'Number', DEFAULTS['GlowSize'], 0, 20),
        ('OverallOpacity', labels['overall'], 'Number', DEFAULTS['OverallOpacity'], 0, 1),
    ]
    controls = {key: user_control(label, kind, default, lo, hi) for key, label, kind, default, lo, hi in params}
    controls.update({
        'Status': user_control(labels['status'], 'Text', readonly=True),
        'Count': user_control('Internal character count', maximum=100000),
        'Sweep': user_control('Internal sweep', maximum=1), 'Pulse': user_control('Internal pulse', maximum=1),
        'MaskWidth': user_control('Internal mask width', maximum=2), 'MaskCenterX': user_control('Internal mask center', minimum=-1, maximum=2),
        'MaskSoft': user_control('Internal mask softness', maximum=1),
        'ResetMotion': user_control(labels['reset_motion'], button_script=reset_script(['Softness','FadeWidth','BounceAmount','BounceHeight','GlowGain','GlowSize'])),
        'ResetLook': user_control(labels['reset_look'], button_script=reset_script(['IdleOpacity','ActiveOpacity','IdleBrightness','IdleBlur','ActiveBlur','OverallOpacity','Size','CharacterSpacing','LineSpacing','Red1','Green1','Blue1'])),
    })
    ctrl = {key: inp(default) for key, _, _, default, _, _ in params}
    ctrl.update({'Status': inp(expression=expression('status')), 'Count': inp(expression=expression('count')),
                 'Sweep': inp(expression=expression('sweep')), 'Pulse': inp(expression=expression('pulse')),
                 'MaskWidth': inp(expression=expression('maskWidth')), 'MaskCenterX': inp(expression=expression('maskCenterX')),
                 'MaskSoft': inp(expression=expression('maskSoft')), 'StyledText': inp(expression=expression('clean')),
                 'Font': inp(font), 'Style': inp(style), 'Size': inp(DEFAULTS['Size']), 'Center': 'Input { Value = { 0.5, 0.54 }, }',
                 'CharacterSpacing': inp(DEFAULTS['CharacterSpacing']), 'LineSpacing': inp(DEFAULTS['LineSpacing']),
                 'Red1': inp(DEFAULTS['Red1']), 'Green1': inp(DEFAULTS['Green1']), 'Blue1': inp(DEFAULTS['Blue1']),
                 'Opacity1': inp(0), 'UseFrameFormatSettings': inp(1), 'Width': inp(1920), 'Height': inp(1080)})
    common = {'StyledText': inp(expression='Controller.StyledText'), 'UseFrameFormatSettings': inp(1),
              'Width': inp(1920), 'Height': inp(1080), 'Font': inp(expression='Controller.Font'),
              'Style': inp(expression='Controller.Style'), 'Size': inp(expression='Controller.Size*(1+Controller.BounceAmount*Controller.Pulse)'),
              'Center': inp(expression='Point(Controller.Center.X, Controller.Center.Y-Controller.BounceHeight*Controller.Pulse)'),
              'CharacterSpacing': inp(expression='Controller.CharacterSpacing'), 'LineSpacing': inp(expression='Controller.LineSpacing'),
              'HorizontalJustificationNew': inp(3), 'VerticalJustificationNew': inp(3)}
    base = dict(common)
    base.update({'Red1': inp(expression='Controller.Red1*Controller.IdleBrightness'), 'Green1': inp(expression='Controller.Green1*Controller.IdleBrightness'),
                 'Blue1': inp(expression='Controller.Blue1*Controller.IdleBrightness'), 'Opacity1': inp(expression='Controller.OverallOpacity*Controller.IdleOpacity')})
    active = dict(common)
    active.update({'Red1': inp(expression='Controller.Red1'), 'Green1': inp(expression='Controller.Green1'), 'Blue1': inp(expression='Controller.Blue1'),
                   'Opacity1': inp(expression='Controller.OverallOpacity*Controller.ActiveOpacity'), 'EffectMask': inp(source='KaraokeMask', output='Mask')})
    nodes = [node('Controller','TextPlus',ctrl,controls,-330,0), node('BaseText','TextPlus',base,x=-180,y=-70),
             node('BaseBlur','Blur',{'Input':inp(source='BaseText'),'XBlurSize':inp(expression='Controller.IdleBlur'),'LockXY':inp(1)},x=-20,y=-70),
             node('KaraokeMask','RectangleMask',{'Width':inp(expression='Controller.MaskWidth'),'Height':inp(1),
                  'Center':inp(expression='Point(Controller.MaskCenterX, 0.5)'),'SoftEdge':inp(expression='Controller.MaskSoft')},x=-180,y=80),
             node('ActiveText','TextPlus',active,x=-20,y=80),
             node('ActiveBlur','Blur',{'Input':inp(source='ActiveText'),'XBlurSize':inp(expression='Controller.ActiveBlur'),'LockXY':inp(1)},x=130,y=80),
             node('HighlightGlow','SoftGlow',{'Input':inp(source='ActiveBlur'),'Gain':inp(expression='Controller.GlowGain*(0.85+0.15*Controller.Pulse)'),
                  'XGlowSize':inp(expression='Controller.GlowSize'),'YGlowSize':inp(expression='Controller.GlowSize'),'Blend':inp(1)},x=280,y=80),
             node('FinalMerge','Merge',{'Background':inp(source='BaseBlur'),'Foreground':inp(source='HighlightGlow'),
                  'Blend':inp(1),'PerformDepthMerge':inp(0)},x=440,y=0)]
    exposed = []
    controls_page = [key for key, *_ in params[:9]] + ['ResetMotion']
    for key in controls_page:
        label = next((x[1] for x in params if x[0] == key), labels['reset_motion'])
        exposed.append(f'        {key} = InstanceInput {{ SourceOp = "Controller", Source = "{key}", Name = {quote(label)}, Page = "Controls", }}')
    exposed.append('        Status = InstanceInput { SourceOp = "Controller", Source = "Status", Page = "Controls", }')
    style_items = [('Font',labels['font'],1),('Style',labels['style'],1),('Size',labels['size'],None),('Center',labels['position'],None),
                   ('CharacterSpacing',labels['tracking'],None),('LineSpacing',labels['line_spacing'],None),
                   ('Red1',labels['color'],2),('Green1',labels['color'],2),('Blue1',labels['color'],2)]
    for key in [x[0] for x in params[9:]]:
        style_items.append((key,next(x[1] for x in params if x[0]==key),None))
    style_items.append(('ResetLook',labels['reset_look'],None))
    for key,label,group in style_items:
        grouping = f' ControlGroup = {group},' if group else ''
        exposed.append(f'        {key} = InstanceInput {{ SourceOp = "Controller", Source = "{key}", Name = {quote(label)}, Page = "Style",{grouping} }}')
    return '''{
  Tools = ordered() {
    AMLLyrics = MacroOperator {
      Inputs = ordered() {
''' + ',\n'.join(exposed) + '''
      },
      Outputs = { MainOutput1 = InstanceOutput { SourceOp = "FinalMerge", Source = "Output", } },
      ViewInfo = GroupInfo { Pos = { 0, 0 } },
      Tools = ordered() {
''' + ',\n'.join(nodes) + '''
      },
    },
  },
  ActiveTool = "AMLLyrics",
}
'''

def write_zip(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0)); info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'dist');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    for locale,label in [('zh','ZH'),('en','EN')]:
        data=build(locale).encode('utf-8'); folder=args.output/locale;folder.mkdir(parents=True,exist_ok=True)
        (folder/'AM Lyrics.setting').write_bytes(data)
        write_zip(args.output/f'AM-Lyrics-{label}.drfx', {'Edit/Titles/AM Lyrics/AM Lyrics.setting':data})
    print(f'Built localized lightweight AM Lyrics titles in {args.output}')
if __name__=='__main__': main()
