"use strict";

// Экспорт слоя и оформления наружу. Обмен с QGIS был односторонним: студия
// читала GeoJSON и эталонные QML, а отдать слой обратно не могла — оформление,
// собранное здесь, приходилось повторять в QGIS руками.
//
// Что здесь важно:
// 1. GeoJSON обязан быть таким, чтобы его прочитала любая программа: WGS84,
//    замкнутые кольца, дыры внутри того же полигона.
// 2. QML обязан описывать ровно то, что видно на холсте: единый знак,
//    категории или диапазоны, плюс подписи. Толщина переводится в миллиметры
//    листа — в QML других единиц по умолчанию нет.
// 3. Служебные поля (с подчёркиванием) наружу не идут: это внутренняя кухня
//    студии, в чужой программе они мусор.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
require(path.join(root, "app-export.js"));
const E = globalThis.GRADO_EXPORT;
assert.ok(E && typeof E.layerToGeoJson === "function", "модуль обязан подниматься без документа");

// местные метры в градусы: для проверки хватает линейного пересчёта
const toLonLat = (x, y) => [37.6 + x / 1000, 55.75 + y / 1000];

// ---------- GeoJSON ----------
{
  const layer = { title: "Зоны", geometry_type: "polygon" };
  const features = [
    { id: 1, props: { zone: "Ж-1", _service: "выкинуть" },
      ring: [[0, 0], [100, 0], [100, 100], [0, 100]],
      holes: [[[20, 20], [40, 20], [40, 40], [20, 40]]] },
    { id: 2, props: { name: "улица" }, line: [[0, 0], [50, 50]] },
    { id: 3, props: { name: "точка" }, point: [10, 10] },
    { id: 4, props: {} },                                  // без геометрии
  ];
  const { collection, skipped } = E.layerToGeoJson(layer, features, { toLonLat });
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.name, "Зоны", "имя слоя обязано ехать в файл");
  assert.match(collection.crs.properties.name, /CRS84/, "система координат обязана быть объявлена");
  assert.equal(skipped, 1, "объект без геометрии обязан считаться пропущенным");
  assert.deepEqual(collection.features.map(f => f.geometry.type), ["Polygon", "LineString", "Point"]);

  const polygon = collection.features[0];
  assert.equal(polygon.geometry.coordinates.length, 2, "дыра обязана остаться внутри того же полигона");
  const ring = polygon.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], "кольцо обязано замыкаться — иначе это не GeoJSON");
  assert.equal(ring.length, 5, "замыкающая точка добавляется, а не дублируется бесконечно");
  assert.ok(ring[0][0] > 37 && ring[0][1] > 55, "координаты обязаны быть в градусах");

  assert.deepEqual(polygon.properties, { zone: "Ж-1" }, "служебные поля наружу не идут");

  // уже замкнутое кольцо не должно замыкаться второй раз
  const closed = E.layerToGeoJson(layer, [{ id: 5, props: {},
    ring: [[0, 0], [10, 0], [10, 10], [0, 0]] }], { toLonLat });
  const closedRing = closed.collection.features[0].geometry.coordinates[0];
  assert.equal(closedRing.length, 4, `лишняя замыкающая точка: ${closedRing.length}`);
}

// ---------- цвета и единицы ----------
{
  assert.equal(E.toQgisColor("#faf0bf"), "250,240,191,255");
  assert.equal(E.toQgisColor("#fff"), "255,255,255,255", "короткая запись цвета");
  assert.equal(E.toQgisColor("rgba(245,219,219,.85)"), "245,219,219,217", "прозрачность из rgba");
  assert.equal(E.toQgisColor("#12345680"), "18,52,86,128", "прозрачность из hex с альфой");
  assert.equal(E.toQgisColor(null, "1,2,3,4"), "1,2,3,4", "без цвета — запасное значение");
  assert.equal(E.toQgisColor("не цвет", "1,2,3,4"), "1,2,3,4", "мусор не должен ломать файл");

  // 1 px при 96 dpi = 0.2646 мм
  assert.equal(E.mm(1), "0.265");
  assert.equal(E.mm(0), "0.000");
}

// ---------- QML: единый знак ----------
{
  const layer = { title: "Зоны", geometry_type: "polygon" };
  const style = { fill: "#faf0bf", stroke: "#b89e59", width: 1.2,
    label_field: "zone", label_font: { size: 12, color: "#333333" } };
  const qml = E.layerToQml(layer, style, {});
  assert.match(qml, /<!DOCTYPE qgis/, "QGIS ждёт свой DOCTYPE");
  assert.match(qml, /renderer-v2 type="singleSymbol"/);
  assert.match(qml, /class="SimpleFill"/, "полигон обязан получить заливку");
  assert.match(qml, /name="color" value="250,240,191,255"/);
  assert.match(qml, /name="outline_color" value="184,158,89,255"/);
  assert.match(qml, /fieldName="zone"/, "подпись обязана попасть в блок labeling");
  assert.match(qml, /<layerGeometryType>2<\/layerGeometryType>/, "тип геометрии — полигон");

  // линия и точка получают свои классы знака
  assert.match(E.layerToQml({ title: "л", geometry_type: "polyline" }, { stroke: "#d91a1a", width: 2, dash: [8, 4] }, {}),
    /class="SimpleLine"/);
  assert.match(E.layerToQml({ title: "л", geometry_type: "polyline" }, { stroke: "#d91a1a", width: 2, dash: [8, 4] }, {}),
    /name="line_style" value="dash"/, "штрих обязан оставаться штрихом");
  assert.match(E.layerToQml({ title: "т", geometry_type: "point" }, { fill: "#2f6fde", marker: { size: 5 } }, {}),
    /class="SimpleMarker"/);

  // слой без подписи не должен получать пустой блок labeling
  assert.doesNotMatch(E.layerToQml(layer, { fill: "#ffffff" }, {}), /labeling/);
  // видимость по масштабу переносится
  assert.match(E.layerToQml(layer, { fill: "#fff", scale_max: 10000 }, {}), /minScale="10000"/);
}

// ---------- QML: диапазоны и категории ----------
{
  const layer = { title: "Здания", geometry_type: "polygon",
    rules: [
      { field: "floors", min: 1, max: 5, patch: { fill: "#ffffb2", stroke: "#806659" }, title: "1 – 5" },
      { field: "floors", min: 5, max: 25, last: true, patch: { fill: "#bd0026", stroke: "#5e0013" }, title: "5 – 25" },
    ] };
  const qml = E.layerToQml(layer, { fill: "#eeeeee" }, {});
  assert.match(qml, /renderer-v2 type="graduatedSymbol" attr="floors"/, "диапазоны обязаны ехать как graduated");
  assert.equal((qml.match(/<range /g) || []).length, 2, "оба класса обязаны быть в файле");
  assert.match(qml, /lower="1" upper="5"/);
  assert.match(qml, /label="1 – 5"/, "подпись класса обязана сохраниться");
  assert.match(qml, /value="255,255,178,255"/, "цвет класса обязан ехать в знак");

  const categorized = E.layerToQml({ title: "Дороги", geometry_type: "polyline" }, { stroke: "#888888" },
    { categoryField: "style_id", categories: [
      { value: "osm.hw.primary", title: "магистраль", style: { stroke: "#d97706", width: 3 } },
      { value: "osm.hw.residential", title: "местная", style: { stroke: "#9a938a", width: 1 } },
    ] });
  assert.match(categorized, /renderer-v2 type="categorizedSymbol" attr="style_id"/);
  assert.equal((categorized.match(/<category /g) || []).length, 2);
  assert.match(categorized, /label="магистраль"/);

  // одна категория — это не классификация, а единый знак
  const single = E.layerToQml({ title: "Дороги", geometry_type: "polyline" }, { stroke: "#888888" },
    { categories: [{ value: "a", title: "одна" }] });
  assert.match(single, /renderer-v2 type="singleSymbol"/);
}

// ---------- экранирование ----------
{
  const qml = E.layerToQml({ title: "Слой", geometry_type: "polygon" },
    { fill: "#fff", label_field: 'поле "с кавычками" & <угловыми>' }, {});
  assert.doesNotMatch(qml, /fieldName="поле "/, "кавычки в имени поля обязаны экранироваться");
  assert.match(qml, /&quot;/, "иначе файл перестанет быть XML");
  assert.match(qml, /&amp;/);
}

// ---------- проводка в приложении ----------
{
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const exportJs = fs.readFileSync(path.join(root, "app-export.js"), "utf8");
  assert.match(app, /\["Выгрузить слой \(GeoJSON \+ QML\)"/, "выгрузка обязана быть в меню слоя");
  assert.match(app, /\["Выгрузить только стиль \(QML\)"/, "и отдельно стиль — им обмениваются чаще всего");
  assert.ok(html.indexOf('src="./app.js') < html.indexOf('src="./app-export.js'));
  assert.match(exportJs, /localToLonLat\(x, y\)/, "координаты обязаны переводиться в WGS84");
  assert.match(exportJs, /URL\.revokeObjectURL\(url\)/, "ссылку на файл обязаны освобождать");
}

console.log("export-layer: OK");
