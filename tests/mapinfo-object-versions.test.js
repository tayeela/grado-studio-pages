"use strict";

// Полигоны и ломаные MapInfo пишет в трёх поколениях, а читалка знала одно.
//
// MapInfo Professional 4.5 и старше пишет регионы и мультилинии типами V450
// (0x2e/0x2f, 0x31/0x32), версия 8 — V800 (0x3d/0x3e, 0x40/0x41). Наша
// читалка знала только V300 (0x0d/0x0e, 0x25/0x26) и на всём остальном
// падала: «объект MapInfo типа 0x2e не поддержан». То есть современная
// выгрузка не открывалась вовсе — при том, что лежит в ней ровно то же самое.
//
// Сверено с MITAB (ogr/ogrsf_frmts/mitab/mitab_mapobjectblock.cpp,
// TABMAPObjPLine::ReadObj): V450 отличается от V300 ТОЛЬКО номером типа,
// V800 — тем, что число секций записано int32, а за ним идут 33 байта,
// назначение которых не знает и сам MITAB.
//
// V450 проверяется на НАСТОЯЩЕМ файле GDAL: у готового региона подменяется
// один байт типа, и разбор обязан дать ту же геометрию до последней вершины.
// V800 живого файла у нас нет, поэтому там сторож держит саму раскладку —
// int32 и пропуск 33 байтов; если появится образец, проверку надо усилить.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { читатьЧистый } = require("./_source");

const root = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "tab");
global.window = globalThis;
require(path.join(root, "app-crs-ru.js"));
require(path.join(root, "app-shp.js"));
require(path.join(root, "app-mapinfo.js"));
const M = globalThis.GRADO_MAPINFO;

const buf = name => {
  const b = fs.readFileSync(path.join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const набор = () => ({
  tab: fs.readFileSync(path.join(FIX, "zones.tab"), "latin1"),
  dat: buf("zones.dat"), map: buf("zones.map"), id: buf("zones.id"),
});

// ---------- V450 обязан читаться как V300 ----------
{
  const эталон = M.readTab(набор()).features[0].geometry;
  assert.equal(эталон.type, "Polygon", "образец — регион с дырой");

  const подменить = код => {
    const s = набор();
    const off = new DataView(s.id).getInt32(0, true);
    const bytes = new Uint8Array(s.map);
    assert.equal(bytes[off], 0x0d, "образец обязан оставаться сжатым регионом V300");
    bytes[off] = код;
    return M.readTab(s).features[0].geometry;
  };
  assert.deepEqual(подменить(0x2e), эталон,
    "V450_REGION_C (0x2e) отличается от V300 только номером типа — по коду MITAB");
}

// ---------- перечень типов совпадает с таблицей MITAB ----------
{
  const источник = читатьЧистый("app-mapinfo.js");
  // TAB_GEOM_* из mitab_priv.h: пары «сжатый / несжатый»
  const ОЖИДАЕМЫЕ = {
    "SYMBOL_C: 0x01": 1, "SYMBOL: 0x02": 1, "LINE_C: 0x04": 1, "LINE: 0x05": 1,
    "PLINE_C: 0x07": 1, "PLINE: 0x08": 1, "REGION_C: 0x0d": 1, "REGION: 0x0e": 1,
    "MULTIPLINE_C: 0x25": 1, "MULTIPLINE: 0x26": 1,
    "V450_REGION_C: 0x2e": 1, "V450_REGION: 0x2f": 1,
    "V450_MULTIPLINE_C: 0x31": 1, "V450_MULTIPLINE: 0x32": 1,
    "V800_REGION_C: 0x3d": 1, "V800_REGION: 0x3e": 1,
    "V800_MULTIPLINE_C: 0x40": 1, "V800_MULTIPLINE: 0x41": 1,
  };
  for (const запись of Object.keys(ОЖИДАЕМЫЕ))
    assert.ok(источник.includes(запись),
      `в таблице типов нет «${запись}» — сверь с TAB_GEOM_* из mitab_priv.h`);
}

// ---------- V800: число секций int32 и 33 байта следом ----------
{
  const источник = читатьЧистый("app-mapinfo.js");
  assert.match(источник, /V800\.has\(type\)\s*\)\s*\{\s*numSections = i32\(\);\s*p \+= 33;/,
    "у V800 число секций записано int32, и за ним идут 33 байта: " +
    "прочитать его как int16 значит разъехаться на всей остальной записи");
}

// ---------- незнакомый тип по-прежнему называется вслух ----------
{
  const s = набор();
  const off = new DataView(s.id).getInt32(0, true);
  new Uint8Array(s.map)[off] = 0x11;                 // TEXT — мы его не читаем
  const { notes } = M.readTab(s);
  assert.ok(Array.isArray(notes) && notes.some(n => /0x11/.test(String(n))),
    `нечитаемый тип обязан быть назван, а не пропущен молча: ${JSON.stringify(notes)}`);
}

console.log("mapinfo-object-versions: OK");
