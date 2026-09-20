-- Stateless Lua 5.1 timeline evaluation: deterministic under scrubbing and reverse playback.
-- Behaviour/parameter reference is pinned in docs/amll-motion-research.md; no DOM code is embedded.
local function textValue(value)
    if type(value) == "string" then return value end
    return value and value.Value or ""
end
local function numberValue(value, fallback)
    if type(value) == "table" then value = value.Value or value[1] end
    return tonumber(value) or fallback
end
local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
local function characters(value)
    local result = {}
    for char in value:gmatch("[%z\1-\127\194-\244][\128-\191]*") do result[#result+1] = char end
    return result
end
local function split(value)
    local result = {}
    for part in (value .. "|"):gmatch("(.-)|") do result[#result+1] = part end
    return result
end
-- Solve CSS cubic-bezier x before evaluating y; a polynomial in time is not CSS easing.
local function bezier(p, x1, y1, x2, y2)
    p = clamp(p, 0, 1)
    if p == 0 or p == 1 then return p end
    local function axis(t, a, b) return 3*(1-t)^2*t*a + 3*(1-t)*t*t*b + t^3 end
    local lo, hi = 0, 1
    for _=1,16 do
        local mid = (lo+hi)/2
        if axis(mid,x1,x2) < p then lo=mid else hi=mid end
    end
    return axis((lo+hi)/2,y1,y2)
end
local function emphasisEnvelope(p)
    if p <= 0 or p >= 1 then return 0 end
    if p < .5 then return bezier(p*2,.2,.4,.58,1) end
    return 1-bezier((p-.5)*2,.3,0,.58,1)
end
local raw = textValue(Controller.Lyrics):gsub("\r\n","\n"):gsub("\r","\n")
local segments = split(raw)
local clean = table.concat(segments, "")
local chars = characters(clean)
local count = #chars
local fps = numberValue(Controller.FPS,0)
if fps <= 0 then fps = tonumber(comp:GetPrefs("Comp.FrameFormat.Rate")) or 24 end
fps = math.max(1,fps)
-- RenderStart changes during partial / single-frame exports. GlobalStart is the stable content origin.
local now = (time-comp.GlobalStart)/fps-numberValue(Controller.Offset,0)
local duration = math.max(1/fps,numberValue(Controller.Duration,4))
local ranges, errorMessage, cursor = {}, nil, 0
for _,segment in ipairs(segments) do
    local length = #characters(segment)
    if length == 0 then errorMessage = "Empty lyric segment" end
    ranges[#ranges+1] = {first=cursor+1,length=length,start=duration*cursor/math.max(1,count),finish=duration*(cursor+length)/math.max(1,count)}
    cursor=cursor+length
end
local timing = textValue(Controller.Timings)
local manual = timing:match("%S") ~= nil
if manual then
    local entries=split(timing)
    if #entries ~= #ranges then errorMessage="Timing count must match segments"
    else
        local previous=0
        for i,entry in ipairs(entries) do
            local a,b=entry:match("^%s*(%d+%.?%d*)%s*%-%s*(%d+%.?%d*)%s*$")
            a,b=tonumber(a),tonumber(b)
            if not a or not b or b<=a or a<previous then errorMessage="Use ascending non-overlapping times";break end
            ranges[i].start,ranges[i].finish=a,b;previous=b
        end
    end
end
if count==0 then errorMessage="Enter lyrics" end
if count>MAX_CHARACTERS then errorMessage="Over 256 characters: split the lyric" end
local valid = errorMessage == nil
local units = {}
local floatEnabled=numberValue(Controller.EnableFloat,1)>0.5
local emphasisEnabled=numberValue(Controller.EnableEmphasis,1)>0.5
local staggerEnabled=numberValue(Controller.EnableStagger,1)>0.5
local baseHeight=numberValue(Controller.FloatHeight,.05)
local minFloat=math.max(.01,numberValue(Controller.FloatDuration,1))
local emphasisStrength=numberValue(Controller.Emphasis,1)
local glowStrength=numberValue(Controller.EnableGlow,1)>0.5 and numberValue(Controller.Glow,1) or 0
local bg=numberValue(Controller.BackgroundVocal,0)>0.5 and 2 or 1
local threshold=numberValue(Controller.EmphasisDuration,1)
local lastBoost=numberValue(Controller.LastWordBoost,1)>0.5
local function cjk(text)
    for _,ch in ipairs(characters(text)) do
        local a,b,c=ch:byte(1,3)
        if a and a>=224 and a<240 and b and c then
            local cp=(a-224)*4096+(b-128)*64+c-128
            if (cp>=0x3400 and cp<=0x9FFF) or (cp>=0x3040 and cp<=0x30FF) or (cp>=0xAC00 and cp<=0xD7A3) then return true end
        end
    end
    return false
end
if valid then
    for rangeIndex,range in ipairs(ranges) do
        local span=range.finish-range.start
        local floatDuration=math.max(minFloat,span)
        local floatProgress=floatEnabled and bezier((now-range.start)/floatDuration,0,0,.58,1) or 0
        local word=segments[rangeIndex]
        local trimmed=word:gsub("^%s+", ""):gsub("%s+$", "")
        local trimmedLength=#characters(trimmed)
        local emphasis=emphasisEnabled and span>=threshold and emphasisStrength>0 and
            (cjk(word) or (trimmedLength>1 and trimmedLength<=7))
        local du=math.max(1,span)
        local amount=du/2
        amount=(amount>1 and math.sqrt(amount) or amount^3)*.6
        local blur=du/3
        blur=(blur>1 and math.sqrt(blur) or blur^3)*.5
        if rangeIndex==#ranges and lastBoost then amount=amount*1.6;blur=blur*1.5;du=du*1.2 end
        amount=math.min(1.2,amount)*emphasisStrength
        blur=math.min(.8,blur)
        -- Ordinary words share one native layout/sweep. Split only emphasized short words.
        -- Long CJK phrases use word-level emphasis rather than exceeding the motion budget.
        local splitChars=staggerEnabled and emphasis and range.length<=8
        local pieces=splitChars and range.length or 1
        for j=0,pieces-1 do
            local first=range.first+(splitChars and j or 0)
            local last=splitChars and first or range.first+range.length-1
            local delay=range.start+(splitChars and du/2.5/math.max(1,range.length)*j or 0)
            local pulse=emphasis and emphasisEnvelope((now-delay)/du) or 0
            local floatPulse=floatEnabled and emphasis and math.sin(clamp((now-delay+.4)/(du*1.4),0,1)*math.pi) or 0
            local start=range.start
            local finish=range.start+(floatEnabled and floatDuration or span)
            if emphasis then start=math.min(start,delay-.4);finish=math.max(finish,delay+du*1.4-.4,delay+du) end
            units[#units+1]={index=first,last=last, progress=clamp((now-range.start)/span,0,1),
                lift=floatEnabled and (bg*(baseHeight*floatProgress+.05*floatPulse)+pulse*.025*amount) or 0,
                scale=1+pulse*.1*amount, dx=splitChars and -pulse*.03*amount*(range.length/2-j) or 0,
                glow=pulse*blur*glowStrength, radius=math.min(.3,blur*.3),
                start=start,finish=math.max(finish,range.finish),
                wordFirst=range.first,wordLast=range.first+range.length-1}
        end
    end
end
local settled, activeEnd = 0, 0
for i,u in ipairs(units) do
    if i==settled+1 and now>=u.finish then settled=i end
    if now>=u.start then activeEnd=i end
end
activeEnd=math.max(activeEnd,settled)
local overflow=math.max(0,activeEnd-settled-SLOT_COUNT)
if overflow>0 then
    local completed=0
    for i,u in ipairs(units) do
        if i==completed+1 and u.progress>=1 then completed=i end
    end
    settled=math.max(settled,math.min(completed,activeEnd-SLOT_COUNT))
    activeEnd=math.min(activeEnd,settled+SLOT_COUNT)
end
local prefix=settled>0 and units[settled].last or 0
local last=activeEnd>0 and units[activeEnd].last or 0
if not valid then prefix=count;last=count end
local slots={}
for slot=1,SLOT_COUNT do
    local index=settled+slot
    if index<=activeEnd then slots[slot]=units[index] end
end
local status=errorMessage and ("STATIC FALLBACK: "..errorMessage) or ((manual and "Custom timing" or "Auto timing").." | "..count.." characters")
if overflow>0 then status=status.." | Dense passage: oldest motion settled early" end
local state=string.format("%d,%d,%d,%d;",prefix,last,count,overflow)
for slot=1,SLOT_COUNT do
    local u=slots[slot]
    if u then
        state=state..string.format("%d,%d,%d,%d,%.9f,%.9f,%.9f,%.9f,%.9f,%.9f;",u.index,u.last,u.wordFirst,u.wordLast,u.progress,u.lift,u.scale,u.dx,u.glow,u.radius)
    else state=state.."0,0,0,0,0,0,1,0,0,0;" end
end
state=state..status
