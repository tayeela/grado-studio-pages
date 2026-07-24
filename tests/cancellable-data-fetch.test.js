"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app-data.js"), "utf8");
const start = source.indexOf("function dataFetchAbortError(");
const end = source.indexOf("async function openDataFetch(", start);
assert.ok(start >= 0 && end > start, "data fetch helpers must remain extractable for this test");

const context = vm.createContext({ Error, JSON });
vm.runInContext(source.slice(start, end), context);

(async () => {
  const calls = [];
  const progress = [];
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, signal: options.signal });
    const key = body.sources[0];
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          groups: [{ layer_id: `source.${key}`, count: key === "osm.roads" ? 3 : 2 }],
          layers: [{ id: `source.${key}` }],
          snapshots: [{ id: key }],
          notes: [`note:${key}`],
        };
      },
    };
  };

  const bbox = [37, 55, 38, 56];
  const sources = ["osm.roads", "nspd.parcels"];
  const batches = await context.fetchExtentSourceBatches(bbox, sources, {
    request,
    onProgress: event => progress.push({ source: event.source, state: event.state, count: event.count }),
  });

  assert.deepEqual(calls.map(call => call.body), [
    { bbox, sources: ["osm.roads"], alignOgd: true },
    { bbox, sources: ["nspd.parcels"], alignOgd: true },
  ], "each source must be fetched separately for real progress");
  assert.deepEqual(progress, [
    { source: "osm.roads", state: "loading", count: undefined },
    { source: "osm.roads", state: "done", count: 3 },
    { source: "nspd.parcels", state: "loading", count: undefined },
    { source: "nspd.parcels", state: "done", count: 2 },
  ]);

  const merged = JSON.parse(JSON.stringify(context.mergeExtentSourceBatches(batches)));
  assert.equal(merged.groups.length, 2);
  assert.equal(merged.layers.length, 2);
  assert.equal(merged.snapshots.length, 2);
  assert.deepEqual(merged.notes, ["note:osm.roads", "note:nspd.parcels"]);

  const controller = new AbortController();
  const stalledRequest = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const pending = context.fetchExtentSourceBatches(bbox, sources, {
    request: stalledRequest,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");

  console.log("cancellable data fetch: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
