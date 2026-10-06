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
-- Cell options (`max-zoom`, `hint`, `caption`, `group`, `fit`,
-- `description`) become
-- `data-panzoom-*` attributes on the cell's images; document options
-- (`max-zoom`, `hint`, `caption`, `loop`, `fit`) go to
-- `window.PANZOOM_OPTIONS`.
-- Captions and galleries are built in panzoom.js from the rendered page.
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

local function has(classes, name)
  return classes ~= nil and classes:includes(name)
end

-- Markdown to HTML, for descriptions. Math stays as \( \) for the page's
-- MathJax (or KaTeX) to typeset in the viewer.
local function markdown_html(text)
  local doc = pandoc.read(text, "markdown")
  return pandoc.write(doc, "html", { html_math_method = "mathjax", wrap_text = "none" })
end

local function mark(img)
  if has(img.classes, "nopanzoom") then return nil end
  -- `description="..."` (as for Quarto's lightbox), shown under the caption.
  local desc = img.attributes["description"]
  if desc ~= nil and desc ~= "" then
    img.attributes["data-panzoom-description"] = markdown_html(desc)
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
local function cell_option(el)
  local value = el.attributes["panzoom"]
  if value == nil then return nil end
  el.attributes["panzoom"] = nil
  if value == "false" then return false end
  local attrs = {}
  if value:sub(1, 1) == "{" then
    local cfg = quarto.json.decode(value)
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
      attrs["data-panzoom-description"] = markdown_html(cfg.description)
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
    el.attributes["lightbox"] = nil
    -- A FloatRefTarget is a Quarto custom node without :walk(); its content
    -- is ordinary Pandoc AST (nested subfigures are plain Divs inside it).
    if el.walk then
      el = mark_all(el, attrs)
    else
      el.content = mark_all(el.content, attrs)
    end
    return el, false
  end
  if match_auto and el.attributes["lightbox"] ~= nil then
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
}
