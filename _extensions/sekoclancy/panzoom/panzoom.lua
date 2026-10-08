-- panzoom: full-screen pan/zoom viewer for figures.
--
-- Images get the viewer when they:
--   * sit inside a code cell with `#| panzoom: true` (or per-cell options,
--     `#| panzoom: { max-zoom: 6, hint: false }`), or inside a `.panzoom` div
--     or cell (`#| classes: panzoom`), including labeled figures and
--     subfigure layouts,
--   * carry the class themselves (`![](x.png){.panzoom}`), or
--   * are block images (figures, or alone in a paragraph) in a document with
--     `panzoom: { match: auto }` -- the same images Quarto's auto lightbox takes.
-- `.nopanzoom` opts a single image out, `#| panzoom: false` a whole cell.
--
-- Cell options (`max-zoom`, `hint`, `caption`, `group`, `fit`) become
-- `data-panzoom-*` attributes on the cell's images; document options
-- (`max-zoom`, `hint`, `caption`, `loop`, `fit`) go to
-- `window.PANZOOM_OPTIONS`.
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

-- Images inside links are never marked, so the link keeps working. But an
-- image the author marked `.panzoom` inside a link gets `.nolightbox`:
-- with Quarto's lightbox on, Quarto drops the link around a captioned
-- image (Quarto 1.9 bug), and the image would then open the viewer instead
-- of following its link. `.nolightbox` keeps Quarto away, and the link.
local function keep_link(link)
  local changed = false
  link.content = link.content:walk({
    Image = function(img)
      if has(img.classes, "panzoom") and not has(img.classes, "nolightbox") then
        img.classes:insert("nolightbox")
        changed = true
        return img
      end
    end,
  })
  if changed then return link, false end
  return nil, false
end

-- Walks `el` and marks every image in it, except those inside links.
-- `attrs` (optional) are per-cell options, copied onto each marked image.
local function mark_all(el, attrs)
  return el:walk({
    traverse = "topdown",
    Link = keep_link,
    -- A cell inside a `.panzoom` div can still opt out: `#| panzoom: false`.
    -- Its images get `.nopanzoom`, since panzoom.js also opens any image
    -- inside a `.panzoom` div.
    Div = function(div)
      if div.attributes["panzoom"] == "false" then
        div.attributes["panzoom"] = nil
        div = div:walk({
          Image = function(img)
            if not has(img.classes, "nopanzoom") then img.classes:insert("nopanzoom") end
            return img
          end,
        })
        return div, false
      end
    end,
    Image = function(img)
      img = mark(img)
      if img and attrs then
        for k, v in pairs(attrs) do img.attributes[k] = v end
      end
      return img
    end,
  })
end

-- Reads a cell's `#| panzoom:` option. Quarto passes it as an attribute:
-- "true"/"false", or JSON for the nested form. Returns false to opt the cell
-- out, otherwise true plus the per-image data attributes for its options.
-- Reads the `#| panzoom: { ... }` attribute. It looks like JSON, but
-- knitr/Quarto (1.9) write string values unescaped: a description with a
-- quote or a backslash (`$\theta$`) is invalid JSON, or decodes to the
-- wrong text (`\t` becomes a tab). So split it at the `,"key":`
-- boundaries ourselves and keep strings exactly as written.
local function parse_options(value)
  local body = value:match("^%s*{(.*)}%s*$")
  if body == nil then return {} end
  local starts = {}
  local pos = 1
  while true do
    local s, e, key = body:find('"([%w_%-]+)"%s*:', pos)
    if s == nil then break end
    -- a key starts the body or follows a comma
    local before = body:sub(1, s - 1):match("(%S?)%s*$")
    if s == 1 or before == "," then
      table.insert(starts, { s = s, e = e, key = key })
    end
    pos = e + 1
  end
  local cfg = {}
  for i, k in ipairs(starts) do
    local stop = starts[i + 1] and starts[i + 1].s - 1 or #body
    local raw = body:sub(k.e + 1, stop):gsub("^%s+", ""):gsub("[%s,]+$", "")
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
  return cfg
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
  if value:sub(1, 1) == "{" then
    local cfg = parse_options(value)
    if cfg["max-zoom"] ~= nil then
      attrs["data-panzoom-max-zoom"] = tostring(cfg["max-zoom"])
    end
    if cfg.hint ~= nil then
      attrs["data-panzoom-hint"] = tostring(cfg.hint)
    end
    if cfg.caption ~= nil then
      attrs["data-panzoom-caption"] = tostring(cfg.caption)
    end
    if cfg.group ~= nil then
      attrs["data-panzoom-group"] = tostring(cfg.group)
    end
    if cfg.fit ~= nil then
      attrs["data-panzoom-fit"] = tostring(cfg.fit)
    end
    if type(cfg.description) == "string" and cfg.description ~= "" then
      attrs["data-panzoom-desc"] = add_description(cfg.description)
    end
  end
  return true, attrs
end

-- Reads the `panzoom:` metadata block and attaches the JS/CSS.
local function setup(meta)
  local options = {}
  local cfg = meta.panzoom
  if cfg ~= nil and pandoc.utils.type(cfg) == "table" then
    if cfg.match ~= nil then
      match_auto = pandoc.utils.stringify(cfg.match) == "auto"
    end
    if cfg["max-zoom"] ~= nil then
      options.maxZoom = tonumber(pandoc.utils.stringify(cfg["max-zoom"]))
    end
    if cfg.hint ~= nil then
      options.hint = cfg.hint ~= false
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
end

-- Handles a `.panzoom` container (div, code cell, or a labeled figure that
-- Quarto has already turned into a FloatRefTarget). In auto mode, also stops
-- at cells that carry their own `#| lightbox:` setting.
local function container(el)
  local on, attrs = cell_option(el)
  if on == false then return el, false end
  if on or has(el.classes, "panzoom") then
    drop_option(el, "lightbox")
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
    Para = function(para)
      local img = sole_image(para)
      if img and match_auto and not wants_lightbox(img) then
        mark(img)
        return para, false
      end
    end,
    Plain = function(plain)
      local img = sole_image(plain)
      if img and match_auto and not wants_lightbox(img) then
        mark(img)
        return plain, false
      end
    end,
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
      if has(img.classes, "panzoom") then
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
    Image = function(img)
      if has(img.classes, "panzoom") and not has(img.classes, "nopanzoom") then
        return pandoc.Link({ img }, img.src, "", pandoc.Attr("", { "panzoom-link" })), false
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
}
