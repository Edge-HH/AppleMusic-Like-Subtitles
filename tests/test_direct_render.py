"""Render topology regression: one reusable source, independent top-level title graphs."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('render_host',ROOT/'workflow-plugin/script-host.py')
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

class Macro:
    def __init__(self): self.inputs={}
    def SetInput(self,key,value): self.inputs[key]=value;return True

class TextPlus:
    def __init__(self): self.value='template text'
    def GetAttrs(self): return {'TOOLS_RegID':'TextPlus','TOOLS_Name':'Title Text'}
    def GetInput(self,name): return self.value if name=='StyledText' else None
    def SetInput(self,name,value):
        if name!='StyledText': return False
        self.value=value;return True

class Comp:
    def __init__(self,flat=True,generic=False): self.flat=flat;self.generic=generic;self.macro=Macro();self.text=TextPlus() if generic else None
    def FindTool(self,name):
        if name=='AppleMusicStyleTitle' and not self.generic: return self.macro
        if name=='MediaIn1' and not self.flat: return object()
        return None
    def GetToolList(self): return {'TextPlus1':self.text} if self.text else {}

class Clip:
    def __init__(self,flat=True,start=0,duration=10,generic=False,unique_id=''):
        self.generic=generic;self.unique_id=unique_id;self.comps={'Composition 1':Comp(flat,generic)};self.start=start;self.duration=duration;self.name='title';self.children=[]
    def GetFusionCompCount(self): return len(self.comps)
    def GetFusionCompByIndex(self,index): return list(self.comps.values())[index-1]
    def GetFusionCompNameList(self): return list(self.comps)
    def ExportFusionComp(self,path,index): Path(path).write_text('test composition',encoding='utf-8');return True
    def ImportFusionComp(self,path):
        assert Path(path).is_file();comp=Comp(generic=self.generic);self.comps['Imported']=comp;return comp
    def LoadFusionCompByName(self,name): return self.comps[name]
    def DeleteFusionCompByName(self,name): del self.comps[name];return True
    def GetMediaPoolItem(self): return self
    def SetClipProperty(self,*args): return True
    def GetDuration(self): return self.duration
    def GetStart(self): return self.start
    def GetEnd(self): return self.start+self.duration
    def SetName(self,name): self.name=name;return True
    def GetUniqueId(self): return self.unique_id
    def GetClipProperty(self): return {'Type':'Fusion Composition'}

class Folder:
    def __init__(self,clips=None): self.clips=clips or []
    def GetName(self): return 'root'
    def GetSubFolderList(self): return []
    def GetClipList(self): return self.clips

class Timeline:
    def __init__(self,project,name='target'): self.project=project;self.name=name;self.tracks=1;self.deleted=[]
    def GetName(self): return self.name
    def GetUniqueId(self): return self.name
    def GetStartFrame(self): return 86400
    def GetStartTimecode(self): return '01:00:00:00'
    def GetCurrentTimecode(self): return '01:00:00:00'
    def GetSetting(self,key): return '24'
    def SetCurrentTimecode(self,value): return True
    def SetMarkInOut(self,a,b,kind): self.duration=b-a+1;return True
    def ClearMarkInOut(self,*args): return True
    def InsertFusionTitleIntoTimeline(self,name): self.project.title_inserts+=1;return Clip(duration=self.duration)
    def CreateFusionClip(self,items): self.project.fusions+=1;return Clip(False,duration=items[0].duration)
    def CreateCompoundClip(self,items,options=None):
        self.project.compounds+=1;c=Clip(False);c.children=list(items);self.project.outer=c;return c
    def DeleteClips(self,items,ripple): self.deleted.extend(items);return True
    def GetTrackCount(self,kind): return self.tracks
    def AddTrack(self,*args): self.tracks+=1;return True
    def SetTrackName(self,*args): return True
    def GetItemListInTrack(self,*args): return []
    def DeleteTrack(self,*args): self.tracks-=1;return True

class Pool:
    def __init__(self,project): self.project=project;self.root=Folder();self.items=[]
    def GetRootFolder(self): return self.root
    def GetCurrentFolder(self): return self.root
    def AddSubFolder(self,*args): return Folder()
    def SetCurrentFolder(self,folder): return True
    def CreateEmptyTimeline(self,name): return Timeline(self.project,name)
    def DeleteTimelines(self,items): return True
    def DeleteClips(self,items): return True
    def AppendToTimeline(self,infos):
        self.project.append_calls+=1
        self.items=[Clip(False,start=x['recordFrame'],duration=x['endFrame']-x['startFrame'],generic=getattr(x['mediaPoolItem'],'generic',False)) for x in infos]
        return self.items

class Project:
    def __init__(self):
        self.fusions=0;self.compounds=0;self.title_inserts=0;self.append_calls=0
        self.timeline=Timeline(self);self.pool=Pool(self);self.original=self.timeline
    def GetCurrentTimeline(self): return self.timeline
    def GetMediaPool(self): return self.pool
    def SetCurrentTimeline(self,t): self.timeline=t;return True

class Resolve:
    def __init__(self): self.project=Project()
    def GetProjectManager(self): return self
    def GetCurrentProject(self): return self.project


def job(mode='scattered'):
    return {'schemaVersion':2,'kind':'amll.resolve.render-job',
      'document':{'source':{'title':'test'},'timing':'word','lines':[
        {'text':f'line{i}','startMs':i*1000,'endMs':(i+1)*1000,'words':[]} for i in range(3)]},
      'render':{'titleSource':'am-default','placementMode':mode},
      'placement':{'timelineId':'target','frameRate':{'numerator':24,'denominator':1},
        'lineFrames':[{'startFrame':86400+i*24,'endFrameExclusive':86424+i*24} for i in range(3)]}}

class DirectRenderTests(unittest.TestCase):
    def test_scattered_has_one_seed_and_no_per_line_nested_graph(self):
        r=Resolve();result=host.render(r,job());p=r.project
        self.assertEqual(p.fusions,1,'do not wrap each line')
        self.assertEqual(p.title_inserts,1)
        self.assertEqual(p.append_calls,1)
        self.assertEqual(p.compounds,0)
        self.assertEqual(result['insertedCount'],3)
        for i,item in enumerate(p.pool.items):
            self.assertEqual(item.GetFusionCompCount(),1)
            self.assertIsNone(item.GetFusionCompByIndex(1).FindTool('MediaIn1'))
            self.assertEqual(item.GetFusionCompByIndex(1).macro.inputs['Lyrics'],f'line{i}')
        self.assertIs(p.timeline,p.original)

    def test_combined_only_adds_one_outer_compound(self):
        r=Resolve();result=host.render(r,job('fusion-clip'));p=r.project
        self.assertEqual(p.fusions,1)
        self.assertEqual(p.compounds,1)
        self.assertEqual(len(p.outer.children),3)
        self.assertTrue(all(x.GetFusionCompByIndex(1).flat for x in p.outer.children))
        self.assertEqual(result['insertedCount'],1)

    def test_invalid_line_fails_before_project_mutation(self):
        r=Resolve();request=job();request['document']['lines'][1]['text']='bad|line'
        with self.assertRaises(host.HostError): host.render(r,request)
        self.assertEqual(r.project.fusions,0)
        self.assertEqual(r.project.title_inserts,0)
        self.assertEqual(r.project.append_calls,0)

    def test_failed_import_rolls_back_only_new_items(self):
        r=Resolve()
        with patch.object(Clip,'ImportFusionComp',return_value=None):
            with self.assertRaises(host.HostError):host.render(r,job())
        self.assertEqual(r.project.original.deleted,r.project.pool.items)
        self.assertIs(r.project.timeline,r.project.original)

    def test_progress_exception_does_not_abort_finished_write(self):
        r=Resolve()
        def broken(_): raise BrokenPipeError('client left')
        self.assertEqual(host.render(r,job(),progress=broken)['insertedCount'],3)
        self.assertFalse(r.project.original.deleted)

    def test_progress_reports_total_and_completion(self):
        r=Resolve();events=[]
        host.render(r,job(),progress=events.append)
        self.assertEqual(events[-1]['stage'],'文字写入完成，正在整理')
        self.assertEqual(events[-1]['completed'],3)
        self.assertEqual([x['completed'] for x in events if x['stage']=='正在写入顶层 Fusion 文字'],[1,2,3])

    def test_media_pool_title_degrades_to_writable_line_text(self):
        r=Resolve();source=Clip(generic=True,unique_id='custom-title');r.project.pool.root.clips=[source]
        request=job();request['render']['titleSource']='media:custom-title'
        request['document']['lines'][0]['text']='bad|line'  # Must not run AppleMusic样式标题 syntax validation.
        result=host.render(r,request)
        self.assertEqual(result['timing'],'line')
        self.assertIn('逐行导入',result['message'])
        self.assertEqual(r.project.title_inserts,0)
        self.assertEqual(r.project.append_calls,2,'one source bootstrap plus the final batch')
        self.assertEqual(r.project.pool.items[0].GetFusionCompByIndex(1).text.value,'bad|line')

if __name__=='__main__':unittest.main()
