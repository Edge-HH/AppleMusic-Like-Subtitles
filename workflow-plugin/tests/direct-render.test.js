'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const renderer = require('../adapters/renderer');

function fixture() {
  const state={fusion:0,compound:0,inserts:0,append:0,deleted:[],clips:[]};
  function clip(flat=true,start=0,duration=48) {
    const makeComp=flat => ({ flat, macro: { inputs:{}, SetInput(k,v){this.inputs[k]=v;return true;} },
      FindTool(name){return name==='AppleMusicStyleTitle'?this.macro:null;} });
    return { comps:{'Composition 1':makeComp(flat)}, start,duration,
      GetStart(){return this.start;},GetDuration(){return this.duration;},SetName(){return true;},SetClipProperty(){return true;},
      GetMediaPoolItem(){return this;},GetFusionCompCount(){return Object.keys(this.comps).length;},
      GetFusionCompNameList(){return Object.keys(this.comps);},GetFusionCompByIndex(i){return Object.values(this.comps)[i-1];},
      async ExportFusionComp(file){await fs.writeFile(file,'test');return true;},
      async ImportFusionComp(file){await fs.access(file);this.comps.Imported=makeComp(true);return this.comps.Imported;},
      LoadFusionCompByName(name){return this.comps[name];},DeleteFusionCompByName(name){delete this.comps[name];return true;},
    };
  }
  function timeline(name) {
    return { name,tracks:1,duration:48,GetName(){return name;},GetUniqueId(){return name;},GetStartFrame(){return 0;},
      SetMarkInOut(a,b){this.duration=b-a+1;return true;},
      InsertFusionTitleIntoTimeline(){state.inserts++;return clip(true,0,this.duration);},
      CreateFusionClip(items){state.fusion++;return clip(false,0,items[0].duration);},
      CreateCompoundClip(items){state.compound++;state.children=[...items];return clip(false);},
      GetTrackCount(){return this.tracks;},AddTrack(){this.tracks++;return true;},SetTrackName(){return true;},
      GetItemListInTrack(){return [];},DeleteTrack(){return true;},DeleteClips(items){state.deleted.push(...items);return true;},
    };
  }
  const root={GetName:()=> 'root',GetSubFolderList:()=> []};
  const pool={GetRootFolder:()=>root,GetCurrentFolder:()=>root,SetCurrentFolder:()=>true,AddSubFolder:()=>root,
    CreateEmptyTimeline:name=>timeline(name),DeleteTimelines:()=>true,DeleteClips:()=>true,
    AppendToTimeline(infos){state.append++;state.clips=infos.map(x=>clip(false,x.recordFrame,x.endFrame-x.startFrame));return state.clips;},
  };
  const target=timeline('target');
  const project={GetMediaPool:()=>pool,SetCurrentTimeline:t=>{state.current=t;return true;}};
  const job={schemaVersion:2,kind:'amll.resolve.render-job',document:{source:{title:'test'},timing:'line',lines:[0,1,2].map(i=>({text:`line${i}`,startMs:i*1000,endMs:(i+1)*1000,words:[]}))},
    render:{titleSource:'am-default',placementMode:'scattered'},placement:{timelineId:'target',frameRate:{numerator:24,denominator:1},lineFrames:[0,1,2].map(i=>({startFrame:i*24,endFrameExclusive:(i+1)*24}))}};
  return {state,job,project,timeline:target};
}

test('原生桥接散落模式同样只创建一份源，逐句顶层合成独立',async()=>{
  const f=fixture(),events=[];const result=await renderer.render({...f,onProgress:x=>events.push(x)});
  assert.equal(result.insertedCount,3);assert.equal(f.state.fusion,1);assert.equal(f.state.inserts,1);assert.equal(f.state.append,1);assert.equal(f.state.compound,0);
  for(const [i,clip] of f.state.clips.entries()) {assert.equal(clip.GetFusionCompCount(),1);assert.equal(clip.GetFusionCompByIndex(1).flat,true);assert.equal(clip.GetFusionCompByIndex(1).macro.inputs.Lyrics,`line${i}`);}
  assert.equal(events.at(-1).completed,3);assert.equal(f.state.current,f.timeline);
});

test('原生桥接合并模式只有一个外层复合片段，不新增汇总 Fusion 包装',async()=>{
  const f=fixture();f.job.render.placementMode='fusion-clip';
  const result=await renderer.render(f);
  assert.equal(result.insertedCount,1);assert.equal(f.state.fusion,1);assert.equal(f.state.compound,1);assert.equal(f.state.children.length,3);
  assert.ok(f.state.children.every(x=>x.GetFusionCompByIndex(1).flat));
});
