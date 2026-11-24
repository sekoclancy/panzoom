-- {{< panzoom-version >}}: the version in this extension's _extension.yml.
return {
  ["panzoom-version"] = function()
    local file = io.open(quarto.utils.resolve_path("_extension.yml"), "r")
    local text = file:read("a")
    file:close()
    return pandoc.Str(text:match("\nversion:%s*([^%s]+)"))
  end
}
