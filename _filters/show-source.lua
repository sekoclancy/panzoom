-- show-source: shows a markdown example's source and renders it below.
--
-- A code block marked `show-source` stays on the page as a markdown code
-- block, followed by its text parsed as markdown, so each example is written
-- once:
--
--   ```show-source
--   ![A photo](photo.jpg){.panzoom}
--   ```
--
-- A block marked `source` is only shown, the same way, for markdown that can't
-- be rendered from its source: a code cell (it runs before any filter), or a
-- shortcode shown escaped next to its use.
--
-- The marker is the one word after the fence, not a class next to
-- `markdown`: Quarto 2 rejects ```markdown {.show-source}, and panache
-- rewrites ```{.markdown .show-source} back to it.
--
-- Run it before Quarto reads the page's structure, so the parsed blocks
-- become figures, cross-references, lightbox, and panzoom images like
-- markdown written directly on the page:
--
--   filters:
--     - path: ../../_filters/show-source.lua
--       at: pre-ast

local MARKERS = { ["show-source"] = true, ["source"] = true }

function CodeBlock(el)
  local marker = el.classes[1]
  if not MARKERS[marker] then
    return nil
  end
  local shown = el:clone()
  shown.classes:remove(1)
  shown.classes:insert(1, "markdown")
  -- Markdown examples have long lines (an image with its attributes): wrap
  -- them instead of scrolling.
  shown.classes:insert("code-overflow-wrap")
  -- Shown like a code cell's code, so cell styling reaches it too.
  shown.classes:insert("cell-code")
  -- A markdown example: the themes wrap it flush left, unlike code.
  shown.classes:insert("markdown-example")
  if marker == "source" then
    -- Quarto leaves shortcodes in cell code alone, escaped ones too: show
    -- {{{< lipsum 4 >}}} as the shortcode it stands for.
    shown.text = shown.text:gsub("{{{<", "{{<"):gsub(">}}}", ">}}")
  end
  local blocks = pandoc.List({ pandoc.Div({ shown }, pandoc.Attr("", { "cell" })) })
  if marker == "show-source" then
    blocks:extend(pandoc.read(el.text, "markdown").blocks)
  end
  return blocks
end
