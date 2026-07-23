"use strict";

// Растровая подложка листа. Что здесь важно:
// 1. Плотность снимка задаёт ИСТОЧНИК, а не мы: при 1:2000 и 300 dpi нужно
//    0,169 м на точку, ESRI даёт 0,168 (зум 19) — впритык; при 1:1000 нужно
//    0,085, и ESRI уже не тянет, а Яндекс тянет (зум 20). Программа обязана
//    считать это и говорить вслух, а не выдавать увеличенный снимок за 300 dpi.
// 2. Яндекс работает в ЭЛЛИПТИЧЕСКОМ Меркаторе, остальные — в сферическом.
//    Перепутать проекции — сдвинуть снимок на километры.
// 3. Sentinel-2 — 10 м на точку в любой год: он честен только на обзорных
//    листах, и это видно из расчёта, а не из веры.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-tiles.js"));
const T = globalThis.GRADO_TILES;
assert.ok(T && typeof T.pickZoom === "function", "модуль обязан подниматься без документа");

const MOSCOW = 55.75;

// ---------- плотность и подбор зума ----------
{
  // 1:2000 при 300 dpi — 0,169 м на точку
  const need = T.metresPerDot(2000, 300);
  assert.ok(Math.abs(need - 0.1693) < 1e-3, `нужно ${need} м/точку`);

  const esri2000 = T.pickZoom({ source: "esri", lat: MOSCOW, scale: 2000, dpi: 300 });
  assert.equal(esri2000.zoom, 19, "на 1:2000 ESRI хватает 19-го зума");
  assert.ok(!esri2000.upscaled, "и увеличивать снимок не приходится");
  assert.ok(Math.abs(esri2000.actualDpi - 302) < 3, `фактически ${esri2000.actualDpi} dpi`);

  const esri1000 = T.pickZoom({ source: "esri", lat: MOSCOW, scale: 1000, dpi: 300 });
  assert.equal(esri1000.zoom, 19, "выше своего предела ESRI не поднимется");
  assert.ok(esri1000.upscaled, "и на 1:1000 снимок придётся увеличивать");
  assert.ok(Math.abs(esri1000.actualDpi - 151) < 3,
    `фактически ${esri1000.actualDpi} dpi — это и надо сказать человеку`);

  const yandex1000 = T.pickZoom({ source: "yandex", lat: MOSCOW, scale: 1000, dpi: 300 });
  assert.equal(yandex1000.zoom, 20, "Яндекс тянет 1:1000 на 20-м зуме");
  assert.ok(!yandex1000.upscaled);
  const yandex500 = T.pickZoom({ source: "yandex", lat: MOSCOW, scale: 500, dpi: 300 });
  assert.equal(yandex500.zoom, 21, "и 1:500 — на 21-м");

  // Sentinel: 10 м на точку — на рабочем листе это мусор, на обзорном норма
  const sentinelWork = T.pickZoom({ source: "eox", lat: MOSCOW, scale: 2000, dpi: 300 });
  assert.ok(sentinelWork.upscaled && sentinelWork.actualDpi < 40,
    `Sentinel на 1:2000 даёт ${sentinelWork.actualDpi} dpi — он не для рабочих листов`);
  const sentinelOverview = T.pickZoom({ source: "eox", lat: MOSCOW, scale: 200000, dpi: 300 });
  assert.ok(!sentinelOverview.upscaled, "а на обзорном 1:200 000 его хватает с запасом");

  // выше требуемого dpi — выше и требования к источнику
  const strict = T.pickZoom({ source: "esri", lat: MOSCOW, scale: 2000, dpi: 600 });
  assert.ok(strict.upscaled, "600 dpi ESRI на 1:2000 уже не тянет");
}

// ---------- проекции ----------
{
  const z = 18;
  const spherical = T.latToTileY(MOSCOW, z, "spherical");
  const elliptical = T.latToTileY(MOSCOW, z, "elliptical");
  assert.notEqual(spherical, elliptical, "у Яндекса своя проекция — номер тайла обязан отличаться");
  const offsetMetres = Math.abs(spherical - elliptical) * T.TILE * T.groundResolution(MOSCOW, z);
  assert.ok(offsetMetres > 1000,
    `расхождение проекций ${Math.round(offsetMetres)} м — перепутать их нельзя`);
  // на экваторе проекции совпадают: там сжатие Земли ни при чём
  assert.ok(Math.abs(T.latToTileY(0, z, "spherical") - T.latToTileY(0, z, "elliptical")) < 1e-9);
  // долгота считается одинаково
  assert.ok(Math.abs(T.lonToTileX(0, 1) - 1) < 1e-9);
  assert.ok(Math.abs(T.lonToTileX(180, 2) - 4) < 1e-9);
}

// ---------- набор тайлов под рамку ----------
{
  // A3 с колонкой при 1:2000 — 620×594 м; в градусах на широте Москвы это
  // примерно 0,0099° по долготе и 0,0053° по широте
  const bbox = [37.60, 55.745, 37.6099, 55.7503];
  const zoom = T.pickZoom({ source: "esri", lat: MOSCOW, scale: 2000 }).zoom;
  const range = T.tileRange({ source: "esri", bbox, zoom });
  assert.ok(range.count > 0, "рамка обязана накрывать тайлы");
  assert.ok(range.x1 > range.x0 && range.y1 > range.y0);
  assert.equal(range.width, (range.x1 - range.x0) * T.TILE);
  // полотно обязано быть не меньше самого охвата
  const groundWidth = (bbox[2] - bbox[0]) * 111320 * Math.cos(MOSCOW * Math.PI / 180);
  const canvasWidth = range.width * T.groundResolution(MOSCOW, zoom);
  assert.ok(canvasWidth >= groundWidth,
    `полотно ${Math.round(canvasWidth)} м уже охвата ${Math.round(groundWidth)} м`);

  // у Яндекса при той же рамке ряд по широте другой — из-за проекции
  const yandexRange = T.tileRange({ source: "yandex", bbox, zoom });
  assert.notEqual(yandexRange.y0, range.y0, "ряд тайлов Яндекса обязан отличаться");
}

// ---------- источники ----------
{
  assert.ok(!T.SOURCES.esriClarity,
    "Clarity отвечает редиректом на другой сервис — мёртвому источнику в списке не место");
  assert.ok(T.SOURCES.yandex.unofficial, "неофициальный источник обязан быть помечен");
  for (const [key, spec] of Object.entries(T.SOURCES)) {
    assert.ok(spec.attribution, `${key}: источник обязан подписываться на листе`);
    assert.match(spec.url(10, 1, 2), /^https:\/\//, `${key}: адрес тайла`);
    assert.ok(spec.maxZoom >= 15 && spec.maxZoom <= 22, `${key}: предел зума`);
  }
}

// ---------- источник по ключу (Copernicus) ----------
{
  const cdse = T.SOURCES.cdse;
  assert.ok(cdse && cdse.needsKey, "квартальные мозаики Copernicus доступны только по ключу");
  assert.match(cdse.url(10, 1, 2, { instance: "abc" }), /sh\.dataspace\.copernicus\.eu\/ogc\/wmts\/abc/,
    "адрес обязан включать идентификатор экземпляра из личного кабинета");
  assert.equal(cdse.maxZoom, 15, "10 м на точку — глубже лезть незачем");
  // на рабочем листе он бесполезен, на обзорном — годен
  const work = T.pickZoom({ source: "cdse", lat: MOSCOW, scale: 2000, dpi: 300 });
  const overview = T.pickZoom({ source: "cdse", lat: MOSCOW, scale: 200000, dpi: 300 });
  assert.ok(work.actualDpi < 30, `на 1:2000 это ${Math.round(work.actualDpi)} dpi`);
  assert.ok(!overview.upscaled, "а на 1:200 000 хватает с запасом");
}

// ---------- проводка ----------
{
  const sheet = fs.readFileSync(path.join(root, "app-sheet.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(sheet, /const raster = await sheetRaster\(doc, context, view, options, current\);/,
    "подложка обязана ложиться ДО чертежа");
  assert.match(sheet, /renderSceneTo\(context[\s\S]{0,120}drawSheetColumn/,
    "порядок: растр → чертёж → колонка");
  assert.match(sheet, /doc\.addJpeg\(built\.bytes, built\.width, built\.height\)/,
    "растр вкладывается как JPEG без перекодирования");
  assert.match(sheet, /function drawAttribution/, "источник тайлов обязан подписываться на листе");
  assert.match(sheet, /Снимок будет увеличен до \$\{sheet\.raster\.dpi\} dpi; резче он не станет\./,
    "нехватку плотности обязаны говорить прямо");
  for (const host of ["core-sat.maps.yandex.net", "tiles.maps.eox.at"]) {
    assert.ok(html.includes(host), `политика безопасности обязана пускать ${host}`);
  }
  assert.ok(!html.includes("clarity.maptiles.arcgis.com"), "мёртвый хост в политике не нужен");
  assert.ok(html.includes("sh.dataspace.copernicus.eu"), "и пускать Copernicus");
  assert.match(sheet, /const CDSE_KEY = "grado-cdse-instance";/,
    "ключ Copernicus личный: он живёт в браузере, а не в проекте");
  assert.match(sheet, /sourceOptions: \{ instance: cdseInstance\(\) \}/,
    "и доезжает до сборки растра");
  assert.doesNotMatch(sheet, /albumConfig[\s\S]{0,80}cdse/i, "в файл проекта ключ не пишется");
}

console.log("sheet-raster: OK");
