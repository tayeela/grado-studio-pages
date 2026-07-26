"use strict";

// Частичный успех выгрузки.
//
// Живой прогон реальной площадки: из четырёх выбранных слоёв OSM отдал 806
// дорог, здания дали сбой — и цикл загрузки обрывался броском. Последствий
// было три, все из одного корня:
//   1) два оставшихся источника НИКОГДА не начинались и навсегда застывали в
//      статусе «Ожидает» — человек смотрел на экран, который не изменится;
//   2) уже загруженные 806 дорог выбрасывались;
//   3) в строке источника значилось одно слово «Ошибка» — без причины, хотя
//      externalFetch формулирует её по-человечески.
//
// Теперь ошибка источника не отменяет остальные: очередь идёт дальше, отказы
// копятся в batches.failures, загруженное применяется, причины называются.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app-data.js"), "utf8");
const start = source.indexOf("function dataFetchAbortError(");
const end = source.indexOf("async function openDataFetch(", start);
assert.ok(start >= 0 && end > start, "загрузчик обязан оставаться извлекаемым");

const context = vm.createContext({ Error, JSON });
vm.runInContext(source.slice(start, end), context);

(async () => {
  const прогресс = [];
  const request = async (url, options) => {
    const ключ = JSON.parse(options.body).sources[0];
    if (ключ === "osm.buildings") throw new Error("Overpass не ответил за 45 с — попробуйте позже");
    return { ok: true, status: 200,
      async json() { return { groups: [{ layer_id: `source.${ключ}`, count: ключ === "osm.roads" ? 806 : 5 }] }; } };
  };

  const sources = ["osm.roads", "osm.buildings", "nspd.parcels", "gisogd.szz"];
  const batches = await context.fetchExtentSourceBatches([37, 55, 38, 56], sources, {
    request, onProgress: p => прогресс.push(p),
  });

  // ---------- очередь дошла до конца ----------
  {
    const начатые = прогресс.filter(p => p.state === "loading").map(p => p.source);
    assert.deepEqual(начатые, sources,
      "после сбоя одного источника остальные ОБЯЗАНЫ начаться: иначе они навсегда " +
      "остаются в статусе «Ожидает», и человек ждёт у экрана, который не изменится");
  }

  // ---------- успешное сохранено ----------
  {
    assert.equal(batches.length, 3, "три источника отдали данные — все три должны остаться");
    const дороги = batches.find(b => b.source === "osm.roads");
    assert.ok(дороги, "загруженные дороги нельзя терять из-за чужого сбоя");
    assert.equal(дороги.data.groups[0].count, 806);
  }

  // ---------- отказ назван и объяснён ----------
  {
    assert.equal(batches.failures.length, 1, "отказ обязан быть записан, а не проглочен");
    const [отказ] = batches.failures;
    assert.equal(отказ.source, "osm.buildings");
    assert.match(отказ.error.message, /Overpass не ответил/,
      "причина обязана дойти до интерфейса целиком: «Ошибка» без причины — " +
      "это не сообщение, а обозначение беды");
  }

  // ---------- отмена по-прежнему отменяет всё ----------
  {
    // Ошибка источника — не то же, что отмена человеком. Отмену выполняем
    // целиком: человек попросил прекратить, а не «сделай что успеешь».
    const controller = { aborted: false };
    let вызовов = 0;
    const requestОтмена = async () => { вызовов++; controller.aborted = true;
      throw Object.assign(new Error("Загрузка отменена"), { name: "AbortError" }); };
    await assert.rejects(
      () => context.fetchExtentSourceBatches([37, 55, 38, 56], ["osm.roads", "nspd.parcels"], {
        request: requestОтмена, signal: controller }),
      /отменена/i, "отмена обязана прерывать всю очередь");
    assert.equal(вызовов, 1, "после отмены следующий источник не запрашивается");
  }

  console.log("partial-data-fetch: OK");
})();
