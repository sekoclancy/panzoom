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
--     - path: show-source.lua
--       at: pre-ast

function CodeBlock(el)
  if not el.classes:includes("show-source") then
    return nil
  end
  local shown = el:clone()
  shown.classes = shown.classes:filter(function(c) return c ~= "show-source" end)
  local blocks = pandoc.List({ shown })
  blocks:extend(pandoc.read(el.text, "markdown").blocks)
  return blocks
end
