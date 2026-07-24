"use strict";

// Проектная СК: все загрузки автоматически перепроецируются в местную
// систему территории. Эталоны — pyproj (см. crs-ru.test.js): точка центра
// Москвы в legacy-локальных (UTM37−origin) обязана перейти в МСК Москвы
// в те же числа, что даёт pyproj для этой СК.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
global.window = globalThis;
const crs = require(path.join(root, "crs.js"));
require(path.join(root, "app-crs-ru.js"));
const R = globalThis.GRADO_CRS_RU;

const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want}`);

// ---------- делегирование в crs.js ----------
{
  assert.equal(crs.projectCrsId(), "utm37-legacy", "по умолчанию — историческая СК");
  // legacy-локальные центра Москвы (pyproj: UTM37 413234.5283, 6179343.7107)
  const legacyLocal = [234.5283, 1343.7107];
  const wgs = crs.localToWgs84(legacyLocal);
  close(wgs[0], 37.6176, 1e-7, "legacy → WGS долгота");
  close(wgs[1], 55.752, 1e-7, "legacy → WGS широта");

  // включаем МСК Москвы (origin [0,0]) — как делает applyProjectCrs
  const def = R.KNOWN.find(k => k.id === "msk-moscow").def;
  crs.setProjectCrs({ id: "msk-moscow",
    fromWgs84: ([lon, lat]) => R.fromWgs84(lon, lat, def),
    toWgs84: ([x, y]) => R.toWgs84(x, y, def) });
  assert.equal(crs.projectCrsId(), "msk-moscow");
  const msk = crs.wgs84ToLocal(wgs);
  close(msk[0], 7499.2218, 0.03, "точка легла в МСК Москвы как у pyproj (восток)");
  close(msk[1], 9469.1604, 0.03, "и север");
  const back = crs.localToWgs84(msk);
  close(back[0], wgs[0], 5e-8, "туда-обратно без потери (5 мм: итерации широты + линеаризованный Гельмерт Бесселя)");
  crs.setProjectCrs(null);
  assert.equal(crs.projectCrsId(), "utm37-legacy", "сброс возвращает историческую");
}

// ---------- МСК-50 зона 2 в таблице ----------
{
  const def = R.KNOWN.find(k => k.id === "msk50-2").def;
  assert.ok(def, "МСК-50-2 добавлена в известные СК");
  const [x, y] = R.fromWgs84(38.0, 55.9, def);
  close(x, 2220143.2513, 0.03, "МСК-50-2 восток (эталон pyproj)");
  close(y, 484734.1548, 0.03, "МСК-50-2 север");
}

// ---------- проводка приложения ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const dxf = fs.readFileSync(path.join(root, "app-dxf.js"), "utf8");
  assert.match(app, /projectCrsId: "auto"/, "новый проект подбирает СК по территории");
  assert.match(app, /resolveAutoProjectCrs\(\);\r?\n\s*return \{ added: plan\.added/,
    "автоопределение срабатывает после импорта источников");
  assert.match(app, /state\.undo = \[\]; state\.redo = \[\];/,
    "смена СК очищает историю — снимки старой СК несовместимы");
  assert.match(app, /projectCrsId: state\.projectCrsId \|\| "utm37-legacy"/,
    "СК проекта сохраняется");
  assert.match(app, /delete saved\.projectCrsId;/, "но не в геометрической истории");
  assert.match(app, /applyProjectCrs\(state\.projectCrsId, \{ reproject: false, silent: true \}\)/,
    "при открытии проекта СК включается без пересчёта — координаты уже в ней");
  assert.match(html, /Система координат проекта…/, "пункт в меню «Проект»");
  assert.match(dxf, /origin: crsInfo \? crsInfo\.origin : \[0, 0\]/,
    "DXF пишет настоящие координаты проектной СК");
  assert.match(dxf, /const numX = value => num\(Number\(value\) \+ dxfOrigin\[0\]\)/,
    "сдвиг применяется ко всем координатным парам");
}

console.log("project-crs: OK");
