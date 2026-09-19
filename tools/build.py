"""Build portable Fusion titles from native nodes, without external playback scripts."""
from pathlib import Path
import argparse
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (ROOT / 'src/timing.lua').read_text(encoding='utf-8-sig')


def quote(value):
    # JSON strings use escapes understood by Lua for the strings generated here.
    return json.dumps(value, ensure_ascii=False)


def literal(value):
    if isinstance(value, str):
        return quote(value)
    return str(value).lower() if isinstance(value, bool) else str(value)


def inp(value=None, expression=None, source=None):
    if source:
        return f'Input {{ SourceOp = "{source}", Source = "Output", }}'
    parts = []
    if value is not None:
        parts.append(f'Value = {literal(value)}')
    if expression is not None:
        parts.append(f'Expression = {quote(expression)}')
    return 'Input { ' + ', '.join(parts) + ', }'


def expression(result, capacity):
    return ':local CAPACITY = ' + str(capacity) + '\n' + RUNTIME + '\nreturn ' + result


def user_control(label, kind='Number', default=0, minimum=0, maximum=1, readonly=False):
    values = {'LINKS_Name': label, 'LINKID_DataType': kind,
              'INPID_InputControl': 'TextEditControl' if kind == 'Text' else 'SliderControl',
              'ICS_ControlPage': 'Controls', 'INP_External': True}
    if kind == 'Text':
        values.update(TEC_Lines=2 if not readonly else 1, TEC_Wrap=True, TEC_ReadOnly=readonly)
    else:
        values.update(INP_Default=default, INP_MinScale=minimum,
                      INP_MaxScale=maximum, INP_MinAllowed=minimum,
                      INP_MaxAllowed=maximum, INP_Integer=False)
    return '{ ' + ', '.join(k + ' = ' + literal(v) for k, v in values.items()) + ', }'


def node(name, node_type, inputs, controls=None, x=0, y=0):
    body = ',\n'.join('            ' + key + ' = ' + value for key, value in inputs.items())
    output = f'''        {name} = {node_type} {{
          Inputs = {{
{body},
          }},
          ViewInfo = OperatorInfo {{ Pos = {{ {x}, {y} }} }},
'''
    if controls:
        output += '          UserControls = ordered() {\n' + ',\n'.join(
            '            ' + key + ' = ' + value for key, value in controls.items()) + ',\n          },\n'
    return output + '        }'


def build(capacity=32, lyrics='我|想要|留住|这一刻', timings='', font='Microsoft YaHei', style='Bold'):
    params = [
        ('Lyrics', 'Lyrics / 用 | 分段', 'Text', lyrics, 0, 1),
        ('Timings', 'Timings / 起止秒数（可留空）', 'Text', timings, 0, 1),
        ('Duration', 'Auto duration / 自动唱完秒数', 'Number', 4, 0.01, 120),
        ('Offset', 'Offset / 整体延后秒数', 'Number', 0.3, -120, 120),
        ('Softness', 'Transition / 每字过渡比例', 'Number', 0.85, 0.01, 1),
        ('FPS', 'FPS / 0 为合成帧率', 'Number', 0, 0, 240),
        ('IdleOpacity', 'Idle opacity / 未唱透明度', 'Number', 0.35, 0, 1),
        ('ActiveOpacity', 'Active opacity / 已唱透明度', 'Number', 1, 0, 1),
        ('IdleBrightness', 'Idle brightness / 未唱亮度', 'Number', 0.85, 0, 1),
        ('IdleBlur', 'Idle blur / 未唱模糊', 'Number', 1.5, 0, 30),
        ('ActiveBlur', 'Active blur / 已唱模糊', 'Number', 0, 0, 30),
        ('OverallOpacity', 'Overall opacity / 总透明度', 'Number', 1, 0, 1),
    ]
    controls = {key: user_control(label, kind, default, lo, hi)
                for key, label, kind, default, lo, hi in params}
    controls['Status'] = user_control('Status / 输入检查', 'Text', readonly=True)
    controls['Count'] = user_control('Internal character count', maximum=100000)
    ctrl = {key: inp(default) for key, _, _, default, _, _ in params}
    ctrl.update({
        'Status': inp(expression=expression('status', capacity)),
        'Count': inp(expression=expression('count', capacity)),
        'StyledText': inp(expression=expression('clean', capacity)),
        'Font': inp(font), 'Style': inp(style), 'Size': inp(0.065),
        'Center': 'Input { Value = { 0.5, 0.5 }, }',
        'UseFrameFormatSettings': inp(1), 'Width': inp(1920), 'Height': inp(1080),
        'HorizontalJustificationNew': inp(3), 'VerticalJustificationNew': inp(3),
        'CharacterSpacing': inp(1), 'LineSpacing': inp(1),
        'Red1': inp(1), 'Green1': inp(1), 'Blue1': inp(1),
        # Invalid input never silently renders a truncated lyric: full static fallback.
        'Opacity1': inp(expression=expression('valid and 0 or Controller.OverallOpacity', capacity)),
    })
    nodes = [node('Controller', 'TextPlus', ctrl, controls, -220, 0)]
    last = 'Controller'
    for index in range(1, capacity + 1):
        glyph, blur, merge = f'Glyph{index:02}', f'Blur{index:02}', f'Merge{index:02}'
        p = glyph + '.Progress'
        values = {
            'StyledText': inp(expression='Controller.StyledText'),
            'UseFrameFormatSettings': inp(1), 'Width': inp(1920), 'Height': inp(1080),
            'Start': inp(expression=f'min(1, {index - 1}/max(Controller.Count, 1))'),
            'End': inp(expression=f'min(1, {index}/max(Controller.Count, 1))'),
            'Progress': inp(expression=expression(f'progress({index})', capacity)),
            'HorizontalJustificationNew': inp(3), 'VerticalJustificationNew': inp(3),
        }
        for key in ['Font', 'Style', 'Size', 'Center', 'CharacterSpacing', 'LineSpacing']:
            values[key] = inp(expression='Controller.' + key)
        for key in ['Red1', 'Green1', 'Blue1']:
            values[key] = inp(expression=f'Controller.{key} * (Controller.IdleBrightness + (1-Controller.IdleBrightness)*max(0,{p}))')
        values['Opacity1'] = inp(expression=f'iif({p}<0, 0, Controller.OverallOpacity*(Controller.IdleOpacity+(Controller.ActiveOpacity-Controller.IdleOpacity)*max(0,{p})))')
        nodes.append(node(glyph, 'TextPlus', values,
                          {'Progress': user_control('Internal progress', minimum=-1)}, 0, index * 40))
        nodes.append(node(blur, 'Blur', {
            'Input': inp(source=glyph),
            'XBlurSize': inp(expression=f'Controller.IdleBlur+(Controller.ActiveBlur-Controller.IdleBlur)*max(0,{p})'),
            'LockXY': inp(1), 'Filter': 'Input { Value = FuID { "Fast Gaussian" }, }',
        }, x=110, y=index * 40))
        nodes.append(node(merge, 'Merge', {
            'Background': inp(source=last), 'Foreground': inp(source=blur),
            'PerformDepthMerge': inp(0),
        }, x=220, y=index * 40))
        last = merge
    exposed = []
    for key, label, *_ in params:
        exposed.append(f'        {key} = InstanceInput {{ SourceOp = "Controller", Source = "{key}", Name = {quote(label)}, Page = "Lyrics", }}')
    exposed.append('        Status = InstanceInput { SourceOp = "Controller", Source = "Status", Page = "Lyrics", }')
    for key, label, group in [
        ('Font', 'Font / 字体', 1), ('Style', 'Weight / 字重', 1),
        ('Size', 'Size / 字号', None), ('Center', 'Position / 位置', None),
        ('CharacterSpacing', 'Tracking / 字距', None), ('LineSpacing', 'Line spacing / 行距', None),
        ('Red1', 'Color / 颜色', 2), ('Green1', 'Color / 颜色', 2), ('Blue1', 'Color / 颜色', 2),
    ]:
        grouping = f' ControlGroup = {group},' if group else ''
        exposed.append(f'        {key} = InstanceInput {{ SourceOp = "Controller", Source = "{key}", Name = {quote(label)}, Page = "Style",{grouping} }}')
    return '''{
  Tools = ordered() {
    AMLLyrics = MacroOperator {
      Inputs = ordered() {
''' + ',\n'.join(exposed) + '''
      },
      Outputs = { MainOutput1 = InstanceOutput { SourceOp = "''' + last + '''", Source = "Output", } },
      ViewInfo = GroupInfo { Pos = { 0, 0 } },
      Tools = ordered() {
''' + ',\n'.join(nodes) + '''
      },
    },
  },
  ActiveTool = "AMLLyrics",
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    outputs = {}
    for capacity in (32, 64):
        name = f'AM Lyrics {capacity}.setting'
        data = build(capacity).encode('utf-8')
        (args.output / name).write_bytes(data)
        outputs[name] = data
    # Deterministic package: DRFX is a ZIP with Edit/Titles beneath the archive root.
    with zipfile.ZipFile(args.output / 'AM-Lyrics.drfx', 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in outputs.items():
            info = zipfile.ZipInfo('Edit/Titles/AM Lyrics/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    print(f'Built {len(outputs)} native titles and AM-Lyrics.drfx in {args.output}')


if __name__ == '__main__':
    main()
