-- Embedded into Fusion expressions by tools/build.py. Lua 5.1 compatible.
-- No filesystem, scripts, plugins or network calls at playback time.
local function textValue(value)
    if type(value) == "string" then return value end
    return value and value.Value or ""
end
local function characters(value)
    local result = {}
    -- UTF-8 code points, not bytes. Complex grapheme clusters are not supported.
    for character in value:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
        result[#result + 1] = character
    end
    return result
end
local function split(value)
    local result = {}
    for part in (value .. "|"):gmatch("(.-)|") do result[#result + 1] = part end
    return result
end
local raw = textValue(Controller.Lyrics):gsub("\r\n", "\n"):gsub("\r", "\n")
local segments = split(raw)
local clean = table.concat(segments, "")
local count = #characters(clean)
local fps = tonumber(Controller.FPS) or 0
if fps <= 0 then fps = tonumber(comp:GetPrefs("Comp.FrameFormat.Rate")) or 24 end
fps = math.max(fps, 1)
local now = (time - comp.RenderStart) / fps - Controller.Offset
local ranges = {}
local errorMessage = nil
local schedule = textValue(Controller.Timings)
local manual = schedule:match("%S") ~= nil
local span = math.max(Controller.Duration, 1 / fps)
local cursor = 0
for _, segment in ipairs(segments) do
    local length = #characters(segment)
    if length == 0 then errorMessage = "Empty segment: remove adjacent or edge |" end
    ranges[#ranges + 1] = {first = cursor + 1, length = length,
        start = span * cursor / math.max(count, 1),
        finish = span * (cursor + length) / math.max(count, 1)}
    cursor = cursor + length
end
if manual then
    local entries = split(schedule)
    if #entries ~= #segments then
        errorMessage = "Timing count must match lyric segments"
    else
        local previousEnd = 0
        for index, entry in ipairs(entries) do
            local a, b = entry:match("^%s*(%d+%.?%d*)%s*%-%s*(%d+%.?%d*)%s*$")
            a, b = tonumber(a), tonumber(b)
            if not a or not b or b <= a or a < previousEnd then
                errorMessage = "Use ascending non-overlapping start-end seconds"
                break
            end
            ranges[index].start, ranges[index].finish = a, b
            previousEnd = b
        end
    end
end
if count > CAPACITY then errorMessage = "Over " .. CAPACITY .. " characters: split clip or use 64-char preset" end
if count == 0 then errorMessage = "Enter lyrics" end
local valid = errorMessage == nil
local status = errorMessage and ("STATIC FALLBACK: " .. errorMessage) or
    ((manual and "Custom timing" or "Auto timing") .. " | " .. count .. "/" .. CAPACITY .. " characters")
local function progress(index)
    if not valid or index > count then return -1 end
    for _, range in ipairs(ranges) do
        if index >= range.first and index < range.first + range.length then
            local step = (range.finish - range.start) / range.length
            local start = range.start + (index - range.first) * step
            local duration = math.max(step * math.max(0.01, Controller.Softness), 0.000001)
            local p = math.max(0, math.min(1, (now - start) / duration))
            -- Smoothstep has zero velocity at both ends; no spring overshoot.
            return p * p * (3 - 2 * p)
        end
    end
    return -1
end
