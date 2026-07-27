"use strict";

// Отбор объектов ПО ХОДУ загрузки — для слоёв, которые портал отдаёт только
// целиком.
//
// Простучано заново: у ГИС ОГД анонимно доступен ровно один маршрут с
// геометрией — export/ всего слоя. filter/ понимает page и limit, но любые
// пространственные ключи (bbox, extent, geometry, spatial, where) молча
// игнорирует; objects/ по POST отвечает 401 и ставит session-cookie; сама
// карта портала (ORBISmap на /gis/) отдаёт 302 на /gis/login/. То есть
// геометрия по области — только вошедшему человеку.
//
// Значит резать надо у себя и НЕ дожидаясь конца файла: «Земельные участки»
// это 269 МБ, а строка JS вдвое тяжелее байтов. Разборщик держит в памяти
// только недочитанный объект.
//
// Полноценный потоковый разбор JSON тут не нужен: достаточно находить
// сбалансированные фигурные скобки внутри массива features. Три места, где
// это ломается молча, и все три проверены ниже.

const assert = require("node:assert/strict");
const path = require("node:path");
const C = require(path.join(__dirname, "..", "pages-core.js"));

const прогнать = (текст, шаг) => {
  const push = C.makeFeatureSplitter();
  const out = [];
  for (let i = 0; i < текст.length; i += шаг) out.push(...push(текст.slice(i, i + шаг)));
  return out.map(s => JSON.parse(s));
};

const точка = (n, x, y) =>
  `{"type":"Feature","properties":{"n":${n}},"geometry":{"type":"Point","coordinates":[${x},${y}]}}`;

// ---------- объект, разорванный границей куска, собирается обратно ----------
{
  const фк = `{"type":"FeatureCollection","name":"zu","features":[${точка(1, 37.6, 55.75)},${точка(2, 38.9, 56.9)}]}`;
  for (const шаг of [1, 2, 3, 7, 17, 64, 4096]) {
    const f = прогнать(фк, шаг);
    assert.equal(f.length, 2, `кусок ${шаг}: объектов ${f.length}, а в потоке 2`);
    assert.deepEqual(f.map(x => x.properties.n), [1, 2], `кусок ${шаг}: порядок объектов`);
  }
}

// ---------- скобка и кавычка ВНУТРИ строки не сбивают счёт ----------
{
  const адрес = 'ул. Строителей, д. 5 {корп 2} \\"литера А\\"';
  const фк = `{"type":"FeatureCollection","features":[` +
    `{"type":"Feature","properties":{"adr":"${адрес}"},"geometry":{"type":"Point","coordinates":[37.6,55.75]}},` +
    `${точка(2, 37.61, 55.76)}]}`;
  for (const шаг of [1, 5, 23, 4096]) {
    const f = прогнать(фк, шаг);
    assert.equal(f.length, 2,
      `кусок ${шаг}: фигурная скобка в названии улицы разъехала счётчик — ` +
      "разбор посыпался бы на середине города");
    assert.match(f[0].properties.adr, /корп 2/, `кусок ${шаг}: текст адреса испорчен`);
  }
}

// ---------- шапка коллекции не считается объектом ----------
{
  // Своя фигурная скобка FeatureCollection закрывается только в конце файла.
  // Если считать её, весь документ читается как ОДИН объект — и разбор
  // кончается вместе с загрузкой, то есть смысла в потоковом отборе нет.
  const фк = `{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"EPSG:4326"}},` +
    `"features":[${точка(1, 37.6, 55.75)}]}`;
  const f = прогнать(фк, 9);
  assert.equal(f.length, 1, "объект в потоке один, а не документ целиком");
  assert.equal(f[0].properties.n, 1, "вложенный crs не должен уехать в объекты");
}

// ---------- отбор по области ----------
{
  const область = [37.5, 55.7, 37.7, 55.8];
  const внутри = { geometry: { type: "Point", coordinates: [37.6, 55.75] } };
  const снаружи = { geometry: { type: "Point", coordinates: [38.9, 56.9] } };
  // участок БОЛЬШЕ площадки: ни одна его вершина внутрь не попала
  const вокруг = { geometry: { type: "Polygon", coordinates: [[[30, 50], [45, 50], [45, 60], [30, 60], [30, 50]]] } };
  const касается = { geometry: { type: "Polygon", coordinates: [[[37.69, 55.79], [38, 55.79], [38, 56], [37.69, 56], [37.69, 55.79]]] } };
  assert.equal(C.featureHitsBbox(внутри, область), true, "объект внутри области");
  assert.equal(C.featureHitsBbox(снаружи, область), false, "объект за областью");
  assert.equal(C.featureHitsBbox(вокруг, область), true,
    "участок, внутри которого лежит вся площадка, обязан попасть в выборку — " +
    "проверка «есть вершина внутри» теряла бы ровно самые крупные участки");
  assert.equal(C.featureHitsBbox(касается, область), true, "объект, задевающий угол области");
  assert.equal(C.featureHitsBbox({ geometry: null }, область), false, "объект без геометрии");
  assert.equal(C.featureHitsBbox(внутри, null), true, "без области отбор не фильтрует");
}

// ---------- в буфере не копится прочитанное ----------
{
  const источник = require("./_source").читатьЧистый("pages-core.js");
  const начало = источник.indexOf("function makeFeatureSplitter");
  const тело = источник.slice(начало, источник.indexOf("function featureHitsBbox"));
  assert.match(тело, /for \(let i = scanned; i < buffer\.length; i\+\+\)/,
    "просматривать заново уже прочитанный хвост нельзя: его скобки посчитаются " +
    "дважды, глубина не вернётся к нулю и разбор замолчит навсегда");
  assert.match(тело, /scanned = buffer\.length;/,
    "после выдачи объектов курсор обязан встать в конец оставшегося буфера");
  assert.match(тело, /buffer = buffer\.slice\(keep\);/,
    "разобранное обязано уходить из буфера, иначе в памяти окажется весь слой");
}

console.log("gisogd-stream-split: OK");
