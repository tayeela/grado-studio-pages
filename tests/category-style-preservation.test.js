"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function layerVisualFormat(");
const end = source.indexOf("function ruleStyleFor(", start);
assert.ok(start >= 0 && end > start,
  "category format helpers must remain extractable for this test");

const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(context.layerVisualFormat({ fmt: {
  stroke: "#111111", cats_off: ["hidden"], cat_styles: { road: { width: 2 } },
  uniform_style: true,
} })), { stroke: "#111111" }, "metadata must never leak into visual style");

assert.deepEqual(plain(context.categoryLayerVisualFormat({ fmt: {
  stroke: "#111111", cat_styles: { road: { width: 2 } },
} })), {}, "category overrides without explicit uniform mode must preserve native styles");

assert.deepEqual(plain(context.categoryLayerVisualFormat({ fmt: {
  stroke: "#111111", cat_styles: { road: { width: 2 } }, uniform_style: true,
} })), { stroke: "#111111" }, "explicit uniform mode must still style every category");

assert.deepEqual(plain(context.categoryLayerVisualFormat({ fmt: {
  stroke: "#222222",
} })), { stroke: "#222222" }, "legacy layer-wide styling without category overrides remains supported");

console.log("category style preservation: ok");
