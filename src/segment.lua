-- Public macro button: 1-based inclusive character range, not hidden marker state.
local function read(name)
    local value=tool:GetInput(name)
    if type(value)=="table" then return value.Value or value[1] or "" end
    return value or ""
end
local function status(message) tool:SetInput("SegmentStatus",message) end
local raw=tostring(read("Lyrics")):gsub("\r\n","\n"):gsub("\r","\n")
local chars,boundaries,spans={}, {}, {}
local first=1
for ch in raw:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    if ch=="|" then
        if #chars<first then status("Invalid empty segment / 存在空分段");return end
        boundaries[#chars]=true;spans[#spans+1]={first=first,last=#chars};first=#chars+1
    else chars[#chars+1]=ch end
end
if #chars<first then status("Enter valid lyrics / 请先输入有效歌词");return end
spans[#spans+1]={first=first,last=#chars}
local a,b=tonumber(read("SegmentStart")),tonumber(read("SegmentEnd"))
if not a or not b or a%1~=0 or b%1~=0 or a<1 or b<a or b>#chars then
    status("Invalid range: 1 <= first <= last <= "..#chars.." / 字符范围无效");return
end
local timing=tostring(read("Timings"))
local entries={}
if timing:match("%S") then
    local previous=0
    for entry in (timing.."|"):gmatch("(.-)|") do
        local start,finish=entry:match("^%s*(%d+%.?%d*)%s*%-%s*(%d+%.?%d*)%s*$")
        start,finish=tonumber(start),tonumber(finish)
        if not start or not finish or finish<=start or start<previous then status("Fix invalid timing first / 请先修正时间");return end
        entries[#entries+1]={start,finish};previous=finish
    end
    if #entries~=#spans then status("Timing count mismatch / 时间数量不匹配");return end
end
if a>1 then boundaries[a-1]=true end
if b<#chars then boundaries[b]=true end
local parts,times={},{}
local start=1
for index=1,#chars do
    if boundaries[index] or index==#chars then
        parts[#parts+1]=table.concat(chars,"",start,index)
        if #entries>0 then
            for i,span in ipairs(spans) do
                if start>=span.first and index<=span.last then
                    local t=entries[i];local step=(t[2]-t[1])/(span.last-span.first+1)
                    times[#times+1]=string.format("%.9f-%.9f",t[1]+(start-span.first)*step,t[1]+(index-span.first+1)*step)
                    break
                end
            end
        end
        start=index+1
    end
end
if comp then comp:StartUndo("Split lyric segment") end
-- Existing boundaries and timing gaps survive. Invalid input never destroys timing.
tool:SetInput("Lyrics",table.concat(parts,"|"))
if #times>0 then tool:SetInput("Timings",table.concat(times,"|")) end
status("Selected / 已分段："..table.concat(chars,"",a,b))
if comp then comp:EndUndo(true) end
