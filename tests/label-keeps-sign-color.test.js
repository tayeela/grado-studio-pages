"use strict";

// Включение подписи красило все линии слоя в серый.
//
// Слой красных линий раскрашен ЗНАКАМИ ОБЪЕКТОВ (у каждой линии свой lgr_code),
// общего цвета у слоя нет. Редактор оформления собирал подпись ВМЕСТЕ с блоком
// «единый стиль»: любая правка подписи поднимала uniformStyleDirty, и в
// layer.fmt уезжал цвет из формы — а он в styleOf кладётся ПОВЕРХ знака. Все
// линии становились цвета формы, то есть серыми.
//
// Проверяем оба конца цепочки: что редактор пишет подпись отдельно от цвета,
// и что слой с одной лишь подписью цвет знака не трогает.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const источник = require("./_source").читатьЧистый("app-style-ui.js");

// ---- конец первый: редактор ----

const collectНачало = источник.indexOf("const collect = ({ forceUniform");
assert.ok(collectНачало > 0, "сборщик оформления должен оставаться извлекаемым");
const collectТело = источник.slice(collectНачало, источник.indexOf("\n  };", collectНачало));

const возврат = collectТело.indexOf("if (!includeUniform) return fmt;");
const подпись = collectТело.indexOf("собратьПодпись(fmt");
assert.ok(возврат > 0 && подпись > 0, "в сборщике должны быть и ранний возврат, и сборка подписи");
assert.ok(подпись < возврат,
  "подпись обязана собираться ДО раннего возврата: иначе она пишется только " +
  "вместе с блоком цвета, и включение подписи перекрашивает весь слой");
assert.match(источник, /function собратьПодпись\(fmt, \$, lcolorCF, baseLabel\)[\s\S]{0,600}fmt\.label_field/,
  "сборщик подписи обязан писать label_field и жить отдельной функцией");

const цвет = collectТело.indexOf("stroke: strokeCF.get()");
assert.ok(цвет > возврат || collectТело.slice(0, возврат).indexOf("includeUniform ? {") >= 0,
  "цвет обводки собирается только в блоке «единый стиль»");

for (const поле of ["fmt-label", "fmt-labelf", "fmt-lsize", "fmt-lcolor", "fmt-lfamily"])
  assert.ok(источник.includes(`"${поле}"`),
    `поле подписи ${поле} должно числиться в списке не-визуальных`);
assert.match(источник, /НЕ_ВИЗУАЛЬНЫЕ\s*=\s*new Set\(\[[^\]]*"fmt-labelf"/s,
  "секция подписи должна быть исключена из признака «единый стиль»");
assert.match(источник, /const визуальный = el\.id !== "fmt-scale-max" && !НЕ_ВИЗУАЛЬНЫЕ\.has\(el\.id\)/,
  "не-визуальные поля должны применяться, но не поднимать uniformStyleDirty");
assert.match(источник, /makeColorField\(\$\("fmt-lcolor"\), toHexColor\(lfFont\.color, "#5c5a54"\), onLabelColor\)/,
  "цвет подписи не должен идти через onColor — он красит текст, а не линию");

// ---- конец второй: разрешение стиля объекта ----

const app = require("./app-source");
const начало = app.indexOf("function layerVisualFormat(");
const конец = app.indexOf("function ruleStyleFor(", начало);
const среда = vm.createContext({});
vm.runInContext(app.slice(начало, конец), среда);

const знак = { stroke: "#fe0004", width: 1, dash: [11.34, 3.78] };   // красная линия ЛГР
const слой = { fmt: { label_field: "doc_num", label_font: { size: 11, color: "#5c5a54", family: "ui" } } };
const итог = { ...знак, ...среда.categoryLayerVisualFormat(слой) };

assert.equal(итог.stroke, "#fe0004",
  "слой с одной лишь подписью не имеет права менять цвет знака объекта");
assert.equal(итог.label_field, "doc_num", "подпись при этом обязана примениться");

// А явная правка «единого стиля» перекрашивает — это осознанное действие.
const единый = { fmt: { stroke: "#888888", uniform_style: true } };
assert.equal({ ...знак, ...среда.categoryLayerVisualFormat(единый) }.stroke, "#888888",
  "явный единый стиль по-прежнему красит весь слой");

console.log("label-keeps-sign-color: OK");
