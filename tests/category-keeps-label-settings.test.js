"use strict";

// Правка ОДНОЙ категории отключала настройки подписи у всего слоя.
//
// Как только у слоя появляются точечные правки категорий, общий layer.fmt
// перестаёт применяться к объектам: иначе он перекрасил бы все категории
// одинаково, а человек правил их по отдельности. Это верно для цвета, ширины,
// штриховки — но НЕ для подписи. Своей подписи у категории нет: поле подписи,
// шрифт, кегль и сам выключатель задаются один раз на слой.
//
// Поэтому возврат пустоты забирал заодно и их: человек выключает подписи слоя
// или меняет поле подписи, а объекты правленых категорий (то есть почти все)
// подписываются по-старому и молча.

const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = require("./app-source");
const start = source.indexOf("function layerVisualFormat(");
const end = source.indexOf("function ruleStyleFor(");
assert.ok(start > 0 && end > start, "разбор оформления слоя обязан оставаться извлекаемым");

const context = vm.createContext({ Object });
vm.runInContext(source.slice(start, end), context);
const { categoryLayerVisualFormat, layerVisualFormat } = context;

const fmt = {
  stroke: "#123456", width: 3, hatch: "diag",     // общее оформление
  line_label: true, label_field: "NAME", label_font: 12,  // подпись слоя
  cats_off: ["a"], uniform_style: undefined,
};

// ---------- категорий не правили: применяется всё ----------
{
  const L = { fmt: { ...fmt } };
  const got = categoryLayerVisualFormat(L);
  assert.equal(got.stroke, "#123456", "без правок категорий общий формат применяется целиком");
  assert.equal(got.line_label, true);
  assert.equal(got.cats_off, undefined, "служебные ключи наружу не выдаются");
}

// ---------- категории правили: цвет уходит, подпись остаётся ----------
{
  const L = { fmt: { ...fmt, cat_styles: { "ogd.x": { stroke: "#f00" } } } };
  const got = categoryLayerVisualFormat(L);
  assert.equal(got.stroke, undefined,
    "общий цвет обязан уступить точечным правкам категорий — ради этого правило и писалось");
  assert.equal(got.width, undefined);
  assert.equal(got.hatch, undefined);
  assert.equal(got.line_label, true,
    "выключатель подписи задаётся на слой, у категории своего нет: терять его нельзя");
  assert.equal(got.label_field, "NAME", "поле подписи — тоже слоевое");
  assert.equal(got.label_font, 12, "и шрифт");
  assert.equal(got.cats_off, undefined, "служебные ключи наружу не выдаются и здесь");
}

// ---------- явный «единый стиль» возвращает всё ----------
{
  const L = { fmt: { ...fmt, uniform_style: true, cat_styles: { "ogd.x": { stroke: "#f00" } } } };
  assert.equal(categoryLayerVisualFormat(L).stroke, "#123456",
    "явная правка блока «Единый стиль» обязана снова красить все категории");
}

// ---------- выключенная подпись передаётся как false, а не теряется ----------
{
  const L = { fmt: { line_label: false, cat_styles: { "ogd.x": { stroke: "#f00" } } } };
  assert.equal(categoryLayerVisualFormat(L).line_label, false,
    "именно этот случай и был жалобой: подписи выключены, а они рисуются");
}

console.log("category-keeps-label-settings: OK");
