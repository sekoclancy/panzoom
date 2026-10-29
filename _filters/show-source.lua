-- show-source: shows a markdown example's source and renders it below.
--
-- A code block marked `.show-source` stays on the page as a code block
-- (without that class), followed by its text parsed as markdown, so each
-- example is written once:
--
--   ```{.markdown .show-source}
--   ![A photo](photo.jpg){.panzoom}
--   ```
--
-- Run it before Quarto reads the page's structure, so the parsed blocks
-- become figures, cross-references, lightbox, and panzoom images like
-- markdown written directly on the page:
--
--   filters:
--     - path: ../../_filters/show-source.lua
--       at: pre-ast

function CodeBlock(el)
  if not el.classes:includes("show-source") then
    return nil
  end
  local shown = el:clone()
  shown.classes = shown.classes:filter(function(c) return c ~= "show-source" end)
  -- Markdown examples have long lines (an image with its attributes): wrap
  -- them instead of scrolling.
  shown.classes:insert("code-overflow-wrap")
  -- Shown like a code cell's code, so cell styling reaches it too.
  shown.classes:insert("cell-code")
  -- A markdown example: the themes wrap it flush left, unlike code.
  shown.classes:insert("markdown-example")
  local blocks = pandoc.List({ pandoc.Div({ shown }, pandoc.Attr("", { "cell" })) })
  blocks:extend(pandoc.read(el.text, "markdown").blocks)
  return blocks
end
