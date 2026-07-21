"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const adapterSource = fs.readFileSync(path.join(__dirname, "..", "pages-adapter.js"), "utf8");
const nativeCalls = [];
const nativeFetch = (url, options = {}) => {
  nativeCalls.push({ url, signal: options.signal });
  return new Promise((resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("native request aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
};

const context = vm.createContext({
  console,
  URL,
  URLSearchParams,
  Request,
  Response,
  Error,
  Date,
  JSON,
  Math,
  Set,
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  },
  document: { addEventListener() {} },
  window: {
    fetch: nativeFetch,
    location: { href: "https://example.test/" },
    addEventListener() {},
    GRADO_PAGES_CORE: {
      originWgs84: [37.62, 55.75],
      buildOsmExtentRequest() { return "[out:json];"; },
      importOsmExtent() { return { groups: [], notes: [], snapshots: [], layers: [] }; },
      buildNspdExtentRequest() { return {}; },
      importNspdExtent() { return { groups: [], notes: [], snapshots: [], layers: [] }; },
      GISOGD_WEB_LAYERS: {},
      gisogdCatalogUrl() { return "https://example.test/catalog"; },
      buildGisogdCatalog(data) { return data; },
      gisogdLayerUrl(code) { return `https://example.test/layer/${code}`; },
    },
  },
});
context.window.window = context.window;
vm.runInContext(adapterSource, context);

(async () => {
  const controller = new AbortController();
  const pending = context.window.fetch("/api/fetch-extent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bbox: [37.6, 55.7, 37.61, 55.71], sources: ["osm.roads"] }),
    signal: controller.signal,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeCalls.length, 1, "adapter must start the underlying source request");
  assert.equal(nativeCalls[0].signal, controller.signal,
    "adapter must forward AbortSignal to the underlying request");
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");

  await assert.rejects(context.window.fetch("/api/fetch-extent", {
    method: "POST",
    body: JSON.stringify({ bbox: [37.6, 55.7, 37.61, 55.71], sources: ["osm.roads"] }),
    signal: controller.signal,
  }), error => error.name === "AbortError", "already-aborted requests must reject before network work");
  assert.equal(nativeCalls.length, 1);

  console.log("pages adapter abort: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
