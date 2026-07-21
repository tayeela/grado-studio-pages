const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, setTimeout, clearTimeout, AbortController });
vm.runInContext(fs.readFileSync(path.join(root, "vendor/polygon-clipping.umd.min.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "app-vector.js"), "utf8"), context);

const vector = context.GRADO_VECTOR;
assert.ok(vector, "vector API must be exposed");

const polygon = (id, x1, y1, x2, y2, props = {}) => ({
  id, props,
  ring: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
});
const a = polygon(1, 0, 0, 10, 10, { name: "A" });
const b = polygon(2, 5, -5, 15, 5, { code: "B" });

(async () => {
  const clip = await vector.computeOperation({ operation: "clip", inputFeatures: [a], overlayFeatures: [b] });
  assert.equal(clip.length, 1);
  assert.equal(vector.geometryArea(clip[0].geometry), 25);
  assert.deepEqual(JSON.parse(JSON.stringify(clip[0].props)), { name: "A" });

  const difference = await vector.computeOperation({ operation: "difference", inputFeatures: [a], overlayFeatures: [b] });
  assert.equal(vector.geometryArea(difference[0].geometry), 75);

  const intersection = await vector.computeOperation({ operation: "intersection", inputFeatures: [a], overlayFeatures: [b] });
  assert.equal(vector.geometryArea(intersection[0].geometry), 25);
  assert.equal(intersection[0].props.mask_code, "B");

  const union = await vector.computeOperation({ operation: "union", inputFeatures: [a], overlayFeatures: [b] });
  assert.equal(vector.geometryArea(union[0].geometry), 175);

  const xor = await vector.computeOperation({ operation: "xor", inputFeatures: [a], overlayFeatures: [b] });
  assert.equal(vector.geometryArea(xor[0].geometry), 150);

  const adjacent = polygon(3, 10, 0, 20, 10, { name: "C" });
  const dissolve = await vector.computeOperation({ operation: "dissolve", inputFeatures: [a, adjacent] });
  assert.equal(vector.geometryArea(dissolve[0].geometry), 200);
  assert.equal(vector.geometryParts(dissolve[0].geometry).length, 1, "shared boundary must be removed");

  const holed = { id: 4, props: {}, ring: [[0, 0], [20, 0], [20, 20], [0, 20]],
    holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]] };
  assert.equal(vector.geometryArea(vector.featureGeometry(holed)), 384);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    vector.computeOperation({ operation: "clip", inputFeatures: [a], overlayFeatures: [b], signal: controller.signal }),
    error => error && error.name === "AbortError"
  );

  console.log("vector operations: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
