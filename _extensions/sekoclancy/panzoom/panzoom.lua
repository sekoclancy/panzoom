-- panzoom: full-screen pan/zoom viewer for figures.
--
-- Images get the viewer when they:
--   * sit inside a code cell with `#| panzoom: true` (or per-cell options,
--     `#| panzoom: { max-zoom: 6, hint: false }`), or inside a `.panzoom`
--     div, including labeled figures and subfigure layouts,
--   * carry the class themselves (`![](x.png){.panzoom}`), or
--   * are block images (figures, or alone in a paragraph) in a document with
--     `panzoom: true` (or `auto`, or `match: auto` in the options map) -- the
--     same images Quarto's `lightbox: true` takes.
-- `.nopanzoom` opts a single image out, `#| panzoom: false` a whole cell,
-- and `panzoom: false` the whole document (as `lightbox: false` does).
-- The document setting takes the forms Quarto's `lightbox:` does.
--
-- Cell options (`max-zoom`, `hint`, `caption`, `group`, `fit`,
-- `desc-position`, and the styling options below) become `data-panzoom-*`
-- attributes on the cell's images; document options (`max-zoom`, `hint`,
-- `caption`, `loop`, `fit`, `desc-position`, `css-class`, `keys`) go to
-- `window.PANZOOM_OPTIONS`; the document's color options
-- (`backdrop`, `panel-background`, `panel-color`, `link-color`) set the
-- viewer's CSS variables in a <style> rule. The styling options
-- (`css-class` and the colors) also work for one cell, or for one markdown
-- image as attributes (`![](x.png){.panzoom backdrop="black"}`); panzoom.js
-- applies them while that image is shown.
-- Captions and galleries are built in panzoom.js from the rendered page.
-- A description (`description` on an image or cell) becomes a hidden
-- `.panzoom-desc` div after the image's top-level block, which Quarto
-- renders like any text (citations, cross-references, math); the image
-- points to it with `data-panzoom-desc`, and panzoom.js shows a copy.
-- Images inside links are always left
-- alone, so the link keeps working.
--
-- Every marked image also gets `.nolightbox`, so Quarto's built-in GLightbox
-- leaves it alone -- no need for `#| lightbox: false` on the chunk.
--
-- In auto mode, an explicit lightbox request wins: images with `.lightbox`,
-- `.nolightbox`, or inside a cell with `#| lightbox:` options (or
-- `#| lightbox: false`) are left to Quarto. Conversely, a cell marked for
-- panzoom (`#| panzoom:` or `classes: panzoom`) has its `#| lightbox:`
-- options removed, because Quarto would otherwise add `.lightbox` to its
-- images, and that beats `.nolightbox`.

if not quarto.doc.is_format("html:js") then return {} end

local match_auto = false

-- Color options and the CSS variables they set (see panzoom.css).
local COLORS = {
  { "backdrop", "--panzoom-backdrop" },
  { "panel-background", "--panzoom-panel-bg" },
  { "panel-color", "--panzoom-panel-fg" },
  { "link-color", "--panzoom-link" },
}

-- The color options as CSS declarations (validate_document has already
-- removed values that could end the rule).
local function color_rules(cfg)
  local decls = {}
  for _, pair in ipairs(COLORS) do
    local key, var = pair[1], pair[2]
    if cfg[key] ~= nil then
      table.insert(decls, var .. ": " .. pandoc.utils.stringify(cfg[key]) .. ";")
    end
  end
  return decls
end

-- Option checks, worded as Quarto's own YAML validation, which extensions
-- can't add to (Quarto 1.9). Each problem is recorded as it is found and
-- all are reported together at the end, which then stops the render, as
-- Quarto does for a bad `lightbox:` option. A filter only runs after the
-- page's code has run, so the report comes after that.
local problems = {}

local function problem(lines)
  table.insert(problems, lines)
end

-- Edit distance, for "Did you mean ...?".
local function distance(a, b)
  local prev = {}
  for j = 0, #b do prev[j] = j end
  for i = 1, #a do
    local cur = { [0] = i }
    for j = 1, #b do
      local cost = a:sub(i, i) == b:sub(j, j) and 0 or 1
      cur[j] = math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    end
    prev = cur
  end
  return prev[#b]
end

local function closest(key, known)
  local best, best_d = nil, 3
  for _, k in ipairs(known) do
    local d = distance(key, k)
    if d < best_d then best, best_d = k, d end
  end
  return best
end

local function unknown_key(key, known, where)
  local lines = { "property name " .. key .. " is invalid",
    "\u{2139} The error happened in location " .. where .. "." }
  local guess = closest(key, known)
  if guess then table.insert(lines, "\u{2139} Did you mean " .. guess .. "?") end
  problem(lines)
end

local function bad_value(key, shown, expected, where, text)
  local lines = { 'Field "' .. key .. '" has value ' .. shown .. ", which must instead be " .. expected,
    "\u{2139} The error happened in location " .. where .. "." }
  -- Words YAML 1.1 read as booleans, or a quoted boolean.
  local word = text and text:lower()
  if word == "true" or word == "yes" or word == "on" or word == "false" or word == "no" or word == "off" then
    table.insert(lines, "\u{2139} Quarto uses YAML 1.2, which interprets booleans strictly.")
    local b = (word == "true" or word == "yes" or word == "on") and "true" or "false"
    table.insert(lines, "\u{2139} Try using " .. b .. " instead.")
  end
  problem(lines)
end

local function one_of(values)
  local quoted = {}
  for _, v in ipairs(values) do table.insert(quoted, "`" .. v .. "`") end
  return "one of: " .. table.concat(quoted, ", ")
end

local FITS = { "auto", "contain", "height", "width" }
-- Where the caption and description go, as for Quarto's lightbox.
local POSITIONS = { "bottom", "top", "left", "right" }
local BOOLEAN = "`true` or `false`"
-- `hint`: true or `show` (the default), `hide` (starts hidden), or false.
local HINTS = { "show", "hide" }

-- What each option accepts: a check on the value, given as
-- { kind = "boolean" | "number" | "string" | "color" | "enum", values = ... },
-- for the document's `panzoom:` map and for a cell's `#| panzoom:` map.
local DOCUMENT_OPTIONS = {
  ["match"] = { kind = "enum", values = { "auto" } },
  ["max-zoom"] = { kind = "number" },
  ["hint"] = { kind = "hint" },
  ["caption"] = { kind = "boolean" },
  ["loop"] = { kind = "boolean" },
  ["fit"] = { kind = "enum", values = FITS },
  ["desc-position"] = { kind = "enum", values = POSITIONS },
  ["css-class"] = { kind = "string" },
  ["keys"] = { kind = "keys" },
}
for _, pair in ipairs(COLORS) do DOCUMENT_OPTIONS[pair[1]] = { kind = "color" } end
local CELL_OPTIONS = {
  ["max-zoom"] = { kind = "number" },
  ["hint"] = { kind = "hint" },
  ["caption"] = { kind = "boolean" },
  ["group"] = { kind = "string" },
  ["fit"] = { kind = "enum", values = FITS },
  ["desc-position"] = { kind = "enum", values = POSITIONS },
  ["description"] = { kind = "string" },
}
-- Options that style the viewer for one image: a cell option, or an
-- attribute on a markdown image.
local STYLE_OPTIONS = { ["css-class"] = { kind = "string" } }
for _, pair in ipairs(COLORS) do STYLE_OPTIONS[pair[1]] = { kind = "color" } end
for k, spec in pairs(STYLE_OPTIONS) do CELL_OPTIONS[k] = spec end

local function names(options)
  local list = {}
  for k in pairs(options) do table.insert(list, k) end
  table.sort(list)
  return list
end
local STYLE_NAMES = names(STYLE_OPTIONS)

-- Checks one value against its spec. `value` is a Lua boolean, number or
-- string, `text` its text (nil for a list or map), `shown` how to print it.
-- Returns true if the value can be used.
local function check(key, spec, value, text, shown, where)
  local ok, expected
  if spec.kind == "boolean" then
    ok, expected = type(value) == "boolean", BOOLEAN
  elseif spec.kind == "hint" then
    ok, expected = type(value) == "boolean", "`true`, `false`, `show`, or `hide`"
    for _, v in ipairs(HINTS) do
      if text == v then ok = true end
    end
  elseif spec.kind == "number" then
    local n = text and tonumber(text)
    ok, expected = n ~= nil and n > 0, "a number greater than 0"
  elseif spec.kind == "string" then
    ok, expected = text ~= nil and type(value) ~= "boolean", "a string"
  elseif spec.kind == "color" then
    ok, expected = text ~= nil and type(value) ~= "boolean" and not text:find("[;{}<]"), "a CSS color"
  else
    ok, expected = false, spec.values[1] == "auto" and #spec.values == 1 and "'auto'" or one_of(spec.values)
    for _, v in ipairs(spec.values) do
      if text == v then ok = true end
    end
  end
  if not ok then bad_value(key, shown, expected, where, type(value) ~= "boolean" and text or nil) end
  return ok
end

-- A metadata value as Lua: a boolean, the text of a string, or nil (a list
-- or a map), and how Quarto would print it.
local function meta_value(v)
  local t = pandoc.utils.type(v)
  if t == "boolean" then return v, tostring(v), tostring(v) end
  if t == "Inlines" or t == "Blocks" or t == "string" then
    local s = pandoc.utils.stringify(v)
    -- A boolean written without quotes arrives as a boolean, so this one was
    -- quoted.
    if s == "true" or s == "false" then return s, s, '"' .. s .. '"' end
    return s, s, s
  end
  if t == "List" then
    local items = {}
    for _, x in ipairs(v) do table.insert(items, pandoc.utils.stringify(x)) end
    return nil, nil, "[" .. table.concat(items, ", ") .. "]"
  end
  return nil, nil, "a map"
end

-- The viewer's actions that `keys:` can rebind, in the order they are
-- reported, and their default keys (as in panzoom.js). Keys are named as in
-- KeyboardEvent.key: one character, or one of NAMED_KEYS.
local ACTIONS = { "caption", "hint", "close", "reset", "zoom-in", "zoom-out" }
local DEFAULT_KEYS = {
  ["caption"] = { "c" },
  ["hint"] = { "h" },
  ["close"] = { "Escape" },
  ["reset"] = { "0" },
  ["zoom-in"] = { "+", "=" },
  ["zoom-out"] = { "-" },
}
local NAMED_KEYS = { "Escape", "Backspace", "Delete", "Insert" }
-- Keys the viewer keeps for itself: focus, buttons, panning, gallery
-- steps, and scrolling a long caption. (Function keys pass through to the
-- browser.)
local FIXED_KEYS = { "Tab", "Enter", "Space", "ArrowLeft", "ArrowRight", "ArrowUp",
  "ArrowDown", "PageUp", "PageDown", "Home", "End" }
local KEY = "one character, " .. table.concat(NAMED_KEYS, ", ") .. ", a list of these, or `false`"

-- Checks one key of an action; returns true if it can be used.
local function check_key(action, key, where)
  local ok = key ~= "" and not key:find("^%s$") and utf8.len(key) == 1
  for _, k in ipairs(NAMED_KEYS) do
    if key == k then ok = true end
  end
  if ok then return true end
  local lines = { 'Field "' .. action .. '" has value ' .. (key == "" and '""' or key) .. ", which must instead be " .. KEY,
    "\u{2139} The error happened in location " .. where .. "." }
  local fixed = key:find("^F%d%d?$") ~= nil
  for _, k in ipairs(FIXED_KEYS) do
    if key == k then fixed = true end
  end
  if fixed then
    table.insert(lines, "\u{2139} " .. key .. " already has its own use in the viewer.")
  elseif key == "" then
    table.insert(lines, '\u{2139} Markdown read the key as formatting: escape it with a backslash, as in "\\\\>".')
  end
  problem(lines)
  return false
end

-- Checks the document's `keys:` map, and replaces it with the valid
-- bindings, as action -> list of keys, or false for none. A key may serve
-- only one action, counting the defaults of the actions left out.
local function validate_keys(cfg)
  local t = pandoc.utils.type(cfg.keys)
  if t ~= "table" then
    local value, text, shown = meta_value(cfg.keys)
    bad_value("keys", shown, "a map of actions to keys", "panzoom:keys", text)
    cfg.keys = nil
    return
  end
  local keys = {}
  for _, action in ipairs(names(cfg.keys)) do
    local v = cfg.keys[action]
    local where = "panzoom:keys:" .. action
    if DEFAULT_KEYS[action] == nil then
      unknown_key(action, ACTIONS, where)
    elseif v == false then
      keys[action] = false
    elseif v == true then
      bad_value(action, "true", KEY, where)
    else
      local list = pandoc.utils.type(v) == "List" and v or { v }
      local good = {}
      for _, x in ipairs(list) do
        local key = pandoc.utils.stringify(x)
        if check_key(action, key, where) then table.insert(good, key) end
      end
      if #good == #list then keys[action] = good end
    end
  end
  local owner = {}
  for _, action in ipairs(ACTIONS) do
    local list = keys[action]
    if list == nil then list = DEFAULT_KEYS[action] end
    for _, key in ipairs(list or {}) do
      local other = owner[key]
      if other then
        local lines = { 'Field "keys" gives the key ' .. key .. " to both " .. other .. " and " .. action,
          "\u{2139} The error happened in location panzoom:keys." }
        for _, a in ipairs({ other, action }) do
          if keys[a] == nil then
            table.insert(lines, "\u{2139} " .. key .. " is the default key of " .. a .. ": give " .. a .. " another key, or `false`.")
          end
        end
        problem(lines)
      else
        owner[key] = action
      end
    end
  end
  cfg.keys = keys
end

-- Checks the document's `panzoom:` value, and removes the options that
-- fail, so the rest of the filter uses their defaults until the report.
local function validate_document(cfg)
  local t = pandoc.utils.type(cfg)
  if cfg == nil or t == "boolean" then return end
  if t ~= "table" then
    local value, text, shown = meta_value(cfg)
    if text ~= "auto" then
      bad_value("panzoom", shown, "`true`, `false`, `auto` or a map of options", "panzoom", text)
    end
    return
  end
  local known = names(DOCUMENT_OPTIONS)
  -- Pandoc keeps no order for the map's keys: report them sorted.
  for _, key in ipairs(names(cfg)) do
    local v = cfg[key]
    local spec = DOCUMENT_OPTIONS[key]
    if spec == nil then
      unknown_key(key, known, "panzoom:" .. key)
      cfg[key] = nil
    elseif spec.kind == "keys" then
      validate_keys(cfg)
    else
      local value, text, shown = meta_value(v)
      if not check(key, spec, value, text, shown, "panzoom:" .. key) then cfg[key] = nil end
    end
  end
end

-- Where a cell or div is, for the report: a cell's first line of code
-- (Jupyter's cell ids are random), else its id.
local function place(el)
  local code
  pandoc.Blocks({ pandoc.Div(el.content or {}) }):walk({
    CodeBlock = function(c)
      if code == nil then code = c.text:match("^%s*([^\n]*)") end
    end,
  })
  if code and code ~= "" then return "the cell starting `" .. code .. "`" end
  local id = el.identifier or el.attr and el.attr.identifier or ""
  if id ~= "" then return "#" .. id end
  return el.classes and el.classes:includes("cell") and "a code cell" or "a div"
end

-- Checks a cell's (or div's) parsed `#| panzoom:` map, and removes the
-- options that fail. Values come from parse_options: booleans, numbers,
-- quoted strings, or the raw text of anything else.
local function validate_cell(cfg, raw, el)
  local known = names(CELL_OPTIONS)
  for _, key in ipairs(raw.order) do
    local v = cfg[key]
    local where = "panzoom:" .. key .. ", in " .. place(el)
    local spec = CELL_OPTIONS[key]
    if spec == nil then
      unknown_key(key, known, where)
      cfg[key] = nil
    else
      local text = tostring(v)
      -- Quotes only where they matter: a quoted boolean or number.
      local quoted = type(v) == "string" and raw[key]:match('^"')
      local shown = (quoted and (text == "true" or text == "false" or tonumber(text))) and raw[key] or text
      local value = v
      -- A list or map written in the cell arrives as raw text.
      if type(v) == "string" and not raw[key]:match('^"') and raw[key]:match("^[%[{]") then
        value, text = nil, nil
      end
      if not check(key, spec, value, text, shown, where) then cfg[key] = nil end
    end
  end
end

-- Prints every problem, as Quarto prints YAML errors, and stops the render.
local function report()
  if #problems == 0 then return nil end
  local file = quarto.doc.input_file and pandoc.path.filename(quarto.doc.input_file) or "the document"
  io.stderr:write("ERROR: Validation of panzoom options failed.\n")
  for _, lines in ipairs(problems) do
    io.stderr:write("ERROR: In file " .. file .. "\n")
    for _, line in ipairs(lines) do io.stderr:write(line .. "\n") end
  end
  io.stderr:write("ERROR: Render failed due to invalid panzoom options.\n")
  os.exit(1)
end
-- `panzoom: false`: the filter does nothing at all.
local off = false
-- Descriptions waiting to be placed (see the last filter pass): id -> text.
local descriptions = {}
local n_descriptions = 0

local function has(classes, name)
  return classes ~= nil and classes:includes(name)
end

-- Records a description's markdown and returns the id of the div it will
-- go in.
local function add_description(text)
  n_descriptions = n_descriptions + 1
  local id = "panzoom-desc-" .. n_descriptions
  descriptions[id] = text
  return id
end

local function mark(img)
  if has(img.classes, "nopanzoom") then return nil end
  -- `description="..."` (as for Quarto's lightbox), shown under the caption.
  local desc = img.attributes["description"]
  if desc ~= nil and desc ~= "" then
    img.attributes["data-panzoom-desc"] = add_description(desc)
    img.attributes["description"] = nil
  end
  -- `desc-position="..."` (as for Quarto's lightbox).
  local pos = img.attributes["desc-position"]
  if pos ~= nil then
    img.attributes["desc-position"] = nil
    if check("desc-position", { kind = "enum", values = POSITIONS }, pos, pos, pos,
        "desc-position, on the image " .. img.src) then
      img.attributes["data-panzoom-desc-position"] = pos
    end
  end
  -- `hint="..."` on the image itself: `true`, `false`, `show`, or `hide`.
  local hint = img.attributes["hint"]
  if hint ~= nil then
    img.attributes["hint"] = nil
    local v = hint == "true" or (hint ~= "false" and hint)
    if check("hint", { kind = "hint" }, v, hint, hint, "hint, on the image " .. img.src) then
      img.attributes["data-panzoom-hint"] = hint
    end
  end
  -- Styling options written on the image itself.
  for _, key in ipairs(STYLE_NAMES) do
    local v = img.attributes[key]
    if v ~= nil then
      img.attributes[key] = nil
      local where = key .. ", on the image " .. img.src
      if check(key, STYLE_OPTIONS[key], v, v, v, where) then
        img.attributes["data-panzoom-" .. key] = v
      end
    end
  end
  img.classes = img.classes:filter(function(c) return c ~= "lightbox" end)
  if not has(img.classes, "panzoom") then img.classes:insert("panzoom") end
  if not has(img.classes, "nolightbox") then img.classes:insert("nolightbox") end
  return img
end

-- Images that auto mode leaves to Quarto's lightbox.
local function wants_lightbox(img)
  return has(img.classes, "lightbox") or has(img.classes, "nolightbox")
end

-- A paragraph holding nothing but one image: a block image, as Quarto's
-- lightbox sees it (`discoverFigure`).
local function sole_image(block)
  if (block.t == "Para" or block.t == "Plain") and #block.content == 1
      and block.content[1].t == "Image" then
    return block.content[1]
  end
end

-- Images inside links are never marked, so the link keeps working. But
-- with Quarto's lightbox on, Quarto drops the link around a captioned
-- image (Quarto 1.9 and 1.10 bug), and an image the author marked
-- `.panzoom` would then open the viewer instead of following its link. So
-- such an image gets `.nolightbox`, which keeps Quarto away, and the link;
-- in auto mode, where panzoom takes the figures lightbox would, so does
-- any image in a link (not one marked `.lightbox`, which is Quarto's).
local function keep_link(link)
  if off then return nil end
  local changed = false
  link.content = link.content:walk({
    Image = function(img)
      local ours = has(img.classes, "panzoom") or (match_auto and not has(img.classes, "lightbox"))
      if ours and not has(img.classes, "nolightbox") then
        img.classes:insert("nolightbox")
        changed = true
        return img
      end
    end,
  })
  if changed then return link, false end
  return nil, false
end

-- Gives every image in an opted-out cell or div `.nopanzoom`, since
-- panzoom.js also opens any image inside a `.panzoom` div: one around it,
-- or its own `.panzoom` class next to `panzoom=false`.
local function opt_out(el)
  local filter = {
    Image = function(img)
      if not has(img.classes, "nopanzoom") then img.classes:insert("nopanzoom") end
      return img
    end,
  }
  if el.walk then return el:walk(filter) end
  el.content = el.content:walk(filter)
  return el
end

-- Reads the `#| panzoom: { ... }` attribute. It looks like JSON, but
-- knitr/Quarto (1.9) write string values unescaped: a description with a
-- quote or a backslash (`$\theta$`) is invalid JSON, or decodes to the
-- wrong text (`\t` becomes a tab). So split it at the `,"key":`
-- boundaries ourselves and keep strings exactly as written.
--
-- A description can itself contain `, "key":` (JSON-like text, say). Quarto
-- writes its own boundaries with no space after the comma, and a string
-- value ends in a quote, so a boundary counts only as `,"key":` straight
-- after a complete value: a closing quote if the value is a string. Only
-- a description containing `","key":` exactly is still split there.
local function parse_options(value)
  local body = value:match("^%s*{(.*)}%s*$")
  if body == nil then return {}, { order = {} } end
  local starts = {}
  local first_s, first_e, first_key = body:find('^%s*"([%w_%-]+)"%s*:')
  if first_s == nil then return {}, { order = {} } end
  table.insert(starts, { s = first_s, e = first_e, key = first_key })
  local pos = first_e + 1
  while true do
    local s, e, key = body:find(',"([%w_%-]+)":', pos)
    if s == nil then break end
    local current = starts[#starts]
    local raw = body:sub(current.e + 1, s - 1):gsub("^%s+", "")
    local complete = raw ~= "" and (raw:sub(1, 1) ~= '"' or (#raw >= 2 and raw:sub(-1) == '"'))
    if complete then
      table.insert(starts, { s = s + 1, e = e, key = key })
    end
    pos = s + 1
  end
  local cfg, raws = {}, { order = {} }
  for i, k in ipairs(starts) do
    local stop = starts[i + 1] and starts[i + 1].s - 1 or #body
    local raw = body:sub(k.e + 1, stop):gsub("^%s+", ""):gsub("[%s,]+$", "")
    raws[k.key] = raw
    table.insert(raws.order, k.key)
    if raw:sub(1, 1) == '"' and raw:sub(-1) == '"' and #raw >= 2 then
      cfg[k.key] = raw:sub(2, -2)
    elseif raw == "true" or raw == "false" then
      cfg[k.key] = raw == "true"
    elseif tonumber(raw) ~= nil then
      cfg[k.key] = tonumber(raw)
    else
      cfg[k.key] = raw
    end
  end
  return cfg, raws
end

-- A line break in an option's string (a YAML `|` block) arrives as the
-- two characters `\n`: knitr and Jupyter write it JSON-escaped, and Pandoc,
-- which unescapes the quotes and backslashes, leaves `\n` alone. Read as
-- markdown, `\nEach` would be a LaTeX command and vanish, so turn `\n`
-- back into a line break. Not inside `$...$` or `$$...$$`, where `\nabla`
-- or `\neq` is TeX; outside math, `\n...` could only be a command HTML
-- drops anyway.
local function line_breaks(text)
  if not text:find("\\n") then return text end
  local out, i, inside = {}, 1, nil
  while i <= #text do
    local c = text:sub(i, i)
    if c == "\\" then
      if text:sub(i + 1, i + 1) == "n" and not inside then
        table.insert(out, "\n")
      else
        -- An escape, kept whole (so `\$` isn't a math delimiter).
        table.insert(out, text:sub(i, i + 1))
      end
      i = i + 2
    elseif c == "$" then
      local d = text:sub(i, i + 1) == "$$" and "$$" or "$"
      if inside == nil then inside = d elseif inside == d then inside = nil end
      table.insert(out, d)
      i = i + #d
    else
      table.insert(out, c)
      i = i + 1
    end
  end
  return table.concat(out)
end

-- Jupyter passes a nested cell option in an attribute of its own,
-- `quarto-private-N = {"key":"panzoom","value":{...}}`, where knitr writes
-- `panzoom = {...}`; the value has the same unescaped strings (see
-- parse_options). Returns the attribute's name and the value's text, or nil.
local function jupyter_option(el, key)
  for k, v in pairs(el.attributes) do
    if k:match("^quarto%-private%-") then
      local value = v:match('^%s*{%s*"key"%s*:%s*"' .. key:gsub("%-", "%%-") .. '"%s*,%s*"value"%s*:%s*(.-)%s*}%s*$')
      if value then return k, value end
    end
  end
  return nil
end

-- Removes a cell option in either form.
local function drop_option(el, key)
  el.attributes[key] = nil
  local k = jupyter_option(el, key)
  if k then el.attributes[k] = nil end
end

-- Reads a cell's `#| panzoom:` option. Quarto passes it as an attribute:
-- "true"/"false", or JSON for the nested form. Returns false to opt the cell
-- out, otherwise true plus the per-image data attributes for its options.
local function cell_option(el)
  local value = el.attributes["panzoom"]
  if value == nil then
    local k
    k, value = jupyter_option(el, "panzoom")
    if k == nil then return nil end
    el.attributes[k] = nil
  end
  el.attributes["panzoom"] = nil
  if value == "false" then return false end
  local attrs = {}
  if value ~= "true" and value:sub(1, 1) ~= "{" then
    -- The YAML hint only fits a code cell; a div's `panzoom=` isn't YAML.
    local is_cell = el.classes and el.classes:includes("cell")
    bad_value("panzoom", value, "`true`, `false` or a map of options", "panzoom, in " .. place(el),
      is_cell and value or nil)
  end
  if value:sub(1, 1) == "{" then
    local cfg, raws = parse_options(value)
    validate_cell(cfg, raws, el)
    local keys = { "max-zoom", "hint", "caption", "group", "fit", "desc-position" }
    for _, key in ipairs(STYLE_NAMES) do table.insert(keys, key) end
    for _, key in ipairs(keys) do
      if cfg[key] ~= nil then
        attrs["data-panzoom-" .. key] = tostring(cfg[key])
      end
    end
    if type(cfg.description) == "string" and cfg.description ~= "" then
      attrs["data-panzoom-desc"] = add_description(line_breaks(cfg.description))
    end
  end
  return true, attrs
end

-- Walks `el` and marks every image in it, except those inside links.
-- `attrs` (optional) are per-cell options, copied onto each marked image.
local function mark_all(el, attrs)
  return el:walk({
    traverse = "topdown",
    Link = keep_link,
    -- A cell inside a `.panzoom` div can still opt out (`#| panzoom: false`)
    -- or set its own options, which win over the div's.
    Div = function(div)
      local on, own = cell_option(div)
      if on == false then return opt_out(div), false end
      if on then
        drop_option(div, "lightbox")
        local merged = {}
        for k, v in pairs(attrs or {}) do merged[k] = v end
        for k, v in pairs(own) do merged[k] = v end
        return mark_all(div, merged), false
      end
    end,
    Image = function(img)
      local own_group = img.attributes["group"] ~= nil
      img = mark(img)
      if img and attrs then
        for k, v in pairs(attrs) do
          -- A div's group yields to an image's own `group="..."`.
          if not (k == "data-panzoom-group" and own_group) then img.attributes[k] = v end
        end
      end
      return img
    end,
  })
end

-- Reads the `panzoom:` metadata and attaches the JS/CSS. Like Quarto's
-- `lightbox:`, it is `true` or `auto` (every block image), `false` (off),
-- or a map of options, where `match: auto` means every block image.
local function setup(meta)
  local options = {}
  local colors = {}
  local cfg = meta.panzoom
  validate_document(cfg)
  if cfg == false then
    off = true
    return
  elseif cfg == true or (pandoc.utils.type(cfg) == "Inlines" and pandoc.utils.stringify(cfg) == "auto") then
    match_auto = true
  elseif cfg ~= nil and pandoc.utils.type(cfg) == "table" then
    if cfg.match ~= nil then
      match_auto = pandoc.utils.stringify(cfg.match) == "auto"
    end
    if cfg["max-zoom"] ~= nil then
      options.maxZoom = tonumber(pandoc.utils.stringify(cfg["max-zoom"]))
    end
    if cfg.hint ~= nil then
      local h = cfg.hint
      if type(h) ~= "boolean" then h = pandoc.utils.stringify(h) end
      options.hint = h == "hide" and "hide" or h ~= false
    end
    if cfg.caption ~= nil then
      options.caption = cfg.caption ~= false
    end
    if cfg.loop ~= nil then
      options.loop = cfg.loop == true
    end
    if cfg.fit ~= nil then
      options.fit = pandoc.utils.stringify(cfg.fit)
    end
    if cfg["desc-position"] ~= nil then
      options.descPosition = pandoc.utils.stringify(cfg["desc-position"])
    end
    -- As Quarto's `lightbox: css-class:`, but added to the viewer as
    -- written, next to `panzoom-overlay` (GLightbox replaces its skin).
    if cfg["css-class"] ~= nil then
      options.cssClass = pandoc.utils.stringify(cfg["css-class"])
    end
    -- Already checked and made plain by validate_keys.
    if cfg.keys ~= nil then
      options.keys = cfg.keys
    end
    colors = color_rules(cfg)
  end

  quarto.doc.add_html_dependency({
    name = "panzoom",
    version = "0.1.0",
    -- Panzoom (https://github.com/timmywil/panzoom), then the viewer
    scripts = { "panzoom.min.js", "panzoom.js" },
    stylesheets = { "panzoom.css" },
  })
  quarto.doc.include_text(
    "in-header",
    "<script>window.PANZOOM_OPTIONS = " .. quarto.json.encode(options) .. ";</script>"
  )
  if #colors > 0 then
    quarto.doc.include_text("in-header",
      "<style>.panzoom-overlay { " .. table.concat(colors, " ") .. " }</style>")
  end
end

-- In auto mode, marks an image alone in a paragraph.
local function block_image(block)
  if off then return nil end
  local img = sole_image(block)
  if img and match_auto and not wants_lightbox(img) then
    mark(img)
    return block, false
  end
end

-- Handles a `.panzoom` container (div, code cell, or a labeled figure that
-- Quarto has already turned into a FloatRefTarget). In auto mode, also stops
-- at cells that carry their own `#| lightbox:` setting.
local function container(el)
  if off then return nil end
  local on, attrs = cell_option(el)
  if on == false then return opt_out(el), false end
  if on or has(el.classes, "panzoom") then
    drop_option(el, "lightbox")
    -- `group="..."` on a `.panzoom` div: every image in it joins one
    -- gallery (an image's own `group` or a cell's option still wins).
    local group = el.attributes and el.attributes["group"]
    if group ~= nil and has(el.classes, "panzoom") then
      el.attributes["group"] = nil
      if check("group", { kind = "string" }, group, group, group, "group, in " .. place(el)) then
        local merged = { ["data-panzoom-group"] = group }
        for k, v in pairs(attrs or {}) do merged[k] = v end
        attrs = merged
      end
    end
    -- A FloatRefTarget is a Quarto custom node without :walk(); its content
    -- is ordinary Pandoc AST (nested subfigures are plain Divs inside it).
    if el.walk then
      el = mark_all(el, attrs)
    else
      el.content = mark_all(el.content, attrs)
    end
    return el, false
  end
  if match_auto and (el.attributes["lightbox"] ~= nil or jupyter_option(el, "lightbox")) then
    return nil, false
  end
end

return {
  { Meta = setup },
  {
    traverse = "topdown",
    Div = container,
    FloatRefTarget = container,
    Link = keep_link,
    Para = block_image,
    Plain = block_image,
    Figure = function(fig)
      if match_auto then
        return fig:walk({
          traverse = "topdown",
          Link = keep_link,
          Image = function(img)
            if not wants_lightbox(img) then return mark(img) end
          end,
        }), false
      end
    end,
    -- Inline images, and block images outside auto mode: explicit class only.
    Image = function(img)
      if has(img.classes, "panzoom") and not off then
        return mark(img)
      end
    end,
  },
  -- Without JavaScript, a marked image is a link to its own file, as with
  -- Quarto's lightbox; panzoom.js stops the link and opens the viewer.
  -- Images already inside a link keep that link.
  {
    traverse = "topdown",
    Link = function() return nil, false end,
    -- Quarto lays out a figure by its image's column class
    -- (`.column-margin`), but no longer sees it once the image is in a link,
    -- and moves only the image, leaving the caption behind. So the class
    -- goes on the figure.
    Figure = function(fig)
      if off then return nil end
      local moved = false
      fig.content = fig.content:walk({
        Image = function(img)
          if not has(img.classes, "panzoom") or has(img.classes, "nopanzoom") then return nil end
          local keep = img.classes:filter(function(c)
            if c:match("^column%-") then
              if not has(fig.classes, c) then fig.classes:insert(c) end
              moved = true
              return false
            end
            return true
          end)
          img.classes = keep
          return img
        end,
      })
      if moved then return fig end
    end,
    Image = function(img)
      if has(img.classes, "panzoom") and not has(img.classes, "nopanzoom") and not off then
        local link = pandoc.Link({ img }, img.src, "", pandoc.Attr("", { "panzoom-link" }))
        -- An image with no alt text would leave the link with no name for
        -- screen readers.
        local alt = img.attributes["alt"]
        if #img.caption == 0 and (alt == nil or alt == "") then
          link.attributes["aria-label"] = "Open image"
        end
        return link, false
      end
    end,
  },
  -- Each description, as a hidden div right after the top-level block
  -- holding its image(s): there Quarto renders it like the text around it
  -- (citations in reading order), and never inside a figure or layout.
  {
    Pandoc = function(doc)
      if n_descriptions == 0 then return nil end
      local blocks = pandoc.Blocks({})
      for _, block in ipairs(doc.blocks) do
        blocks:insert(block)
        local ids = {}
        pandoc.Blocks({ block }):walk({
          Image = function(img)
            local id = img.attributes["data-panzoom-desc"]
            if id and descriptions[id] then
              table.insert(ids, id)
            end
          end,
        })
        for _, id in ipairs(ids) do
          if descriptions[id] then
            blocks:insert(pandoc.Div(pandoc.read(descriptions[id], "markdown").blocks,
              pandoc.Attr(id, { "panzoom-desc" })))
            descriptions[id] = nil
          end
        end
      end
      doc.blocks = blocks
      return doc
    end,
  },
  -- Last: every bad option at once, then stop (see `problems`).
  { Pandoc = report },
}
