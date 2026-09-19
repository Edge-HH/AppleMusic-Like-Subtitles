-- Resolve scans Lua entries even when its embedded Python is unavailable.
-- Keep the host outside Utility so private implementation files are not menu entries.
local source = debug.getinfo(1, "S").source:gsub("^@", "")
local directory = source:match("^(.*)[/\\]")
assert(directory, "Cannot locate AMLL launcher")
local appDirectory=directory
local config=io.open(directory .. [[\amll-app.path]], "rb")
if config then
    appDirectory=config:read("*a"):gsub("^\239\187\191", ""):gsub("%s+$", "")
    config:close()
end
assert(not appDirectory:find('["\r\n]'), "Invalid AMLL application path")
local launch = appDirectory .. [[\launch.ps1]]
local file = io.open(launch, "rb")
assert(file, "AMLL installation is incomplete; reinstall the full package")
file:close()
-- Windows filenames cannot contain quotes. No user-supplied arguments enter this command.
local command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' .. launch .. '"'
os.execute(command)
