"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = appSource.indexOf("function importedLayerGeometry(");
const end = appSource.indexOf("const DEFAULT_ALBUM_CONFIG", start);
assert.ok(start >= 0 && end > start, "transaction functions must remain extractable for this test");

const context = vm.createContext({
  console,
  CODE_TO_GEOM: { "generic.point": "point", "generic.line": "polyline", "generic.polygon": "polygon" },
  GENERIC_CODE: { point: "generic.point", polyline: "generic.line", polygon: "generic.polygon" },
  LAYERS_V2: [],
  LAYER_BY_ID: Object.create(null),
  LAYER_BY_KIND: Object.create(null),
  state: { features: [], nextId: 1, sources: [], undo: [], redo: ["redo"], selected: 99 },
  failAfterChange: false,
  upgradeFeature(feature, resolveLayer) {
    const layer = resolveLayer(feature);
    if (layer) { feature.layer_id = layer.id; feature.kind ||= layer.kind; }
    feature.geometry_type = feature.point ? "point" : feature.line ? "polyline" : "polygon";
    return feature;
  },
  snapshot: null,
  recordSource: null,
  renderSources() {},
  renderLayers() {},
  renderProps() {},
  draw() {},
  syncHistoryControls() {},
  afterChange: null,
  rebuildLayerIndexes: null,
});
context.snapshot = () => {
  context.state.undo.push("before import");
  context.state.redo = [];
};
context.recordSource = source => {
  if (source) context.state.sources.unshift(source);
};
context.afterChange = () => {
  if (context.failAfterChange) throw new Error("forced commit failure");
};
context.rebuildLayerIndexes = () => {
  for (const id of Object.keys(context.LAYER_BY_ID)) delete context.LAYER_BY_ID[id];
  for (const layer of context.LAYERS_V2) context.LAYER_BY_ID[layer.id] = layer;
};
vm.runInContext(appSource.slice(start, end), context);

const spec = code => ({
  id: `source.gisogd.${code}`,
  title: `Слой ${code}`,
  kind: "restrict",
  code: "generic.polygon",
  geometry_type: "polygon",
  source_kind: "gisogd",
  source_code: code,
  source_name: `Слой ${code}`,
});
const feature = (code, key) => ({
  layer_id: `source.gisogd.${code}`,
  kind: "restrict",
  ring: [[0, 0], [10, 0], [0, 10]],
  props: {},
  srcKey: key,
});

const plan = context.prepareSourceImport({
  layers: [spec("virtual1")],
  features: [feature("virtual1", "virtual1:1")],
  fieldsByLayer: { "source.gisogd.virtual1": [{ name: "NAME", type: "text" }] },
  snapshots: [{ snapshot: { id: "snapshot-1" } }],
});
assert.equal(context.state.features.length, 0, "prepare must not mutate project features");
assert.equal(context.LAYERS_V2.length, 0, "prepare must not register layers");

context.commitPreparedSourceImport(plan);
assert.equal(context.state.features.length, 1);
assert.equal(context.LAYERS_V2.length, 1);
assert.equal(context.state.sources.length, 1);
assert.equal(context.state.undo.length, 1, "one import must create one undo point");

const duplicate = context.prepareSourceImport({
  layers: [spec("virtual1")],
  features: [feature("virtual1", "virtual1:1")],
});
assert.equal(duplicate.added, 0);
assert.equal(duplicate.dup, 1);

assert.throws(() => context.prepareSourceImport({
  layers: [{ ...spec("virtual1"), source_code: "another-source" }],
  features: [],
}), /Коллизия/);

const existingLayer = context.LAYER_BY_ID["source.gisogd.virtual1"];
existingLayer.visible = false;
existingLayer._fmtInit = false;
existingLayer.fmt = { stroke: "#123456" };
const beforeRollback = {
  features: context.state.features.length,
  layers: context.LAYERS_V2.length,
  nextId: context.state.nextId,
  sources: context.state.sources.slice(),
  undo: context.state.undo.slice(),
  redo: context.state.redo.slice(),
  selected: context.state.selected,
  existingLayer: JSON.parse(JSON.stringify({
    visible: existingLayer.visible,
    fields: existingLayer.fields,
    fmt: existingLayer.fmt,
    fmtInit: existingLayer._fmtInit,
  })),
};
const failingPlan = context.prepareSourceImport({
  layers: [spec("virtual1"), spec("virtual2")],
  features: [feature("virtual2", "virtual2:1")],
  fieldsByLayer: { "source.gisogd.virtual1": [{ name: "EXTRA", type: "text" }] },
  snapshots: [{ snapshot: { id: "snapshot-2" } }],
});
context.failAfterChange = true;
assert.throws(() => context.commitPreparedSourceImport(failingPlan), /forced commit failure/);
assert.equal(context.state.features.length, beforeRollback.features);
assert.equal(context.LAYERS_V2.length, beforeRollback.layers);
assert.equal(context.state.nextId, beforeRollback.nextId);
assert.deepEqual(context.state.sources, beforeRollback.sources);
assert.deepEqual(context.state.undo, beforeRollback.undo);
assert.deepEqual(context.state.redo, beforeRollback.redo);
assert.equal(context.state.selected, beforeRollback.selected);
assert.equal(context.LAYER_BY_ID["source.gisogd.virtual2"], undefined);
assert.deepEqual(JSON.parse(JSON.stringify({
  visible: existingLayer.visible,
  fields: existingLayer.fields,
  fmt: existingLayer.fmt,
  fmtInit: existingLayer._fmtInit,
})), beforeRollback.existingLayer);

console.log("transactional import: ok");
