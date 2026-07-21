const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
assert.doesNotMatch(source, /\.map\(upgradeFeature\)/,
  "upgradeFeature must be wrapped when used as an Array.map callback; map's index is not a layer resolver");
console.log("history restore callback: ok");
