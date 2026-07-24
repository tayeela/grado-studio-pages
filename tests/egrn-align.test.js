"use strict";

// Автопривязка выгрузки ГИС ОГД к границам участков ЕГРН. Замер по городу:
// в центре линии портала лежат на границах ЕГРН с точностью сантиметров,
// в отдельных районах оцифровка гуляет на 1–3 м ЛОКАЛЬНО — датум ни при
// чём (сдвиг разный по районам). Правка — локальный МНК-вектор с двойной
// защитой: заметность (>0.7 м) и подтверждение остатками (после сдвига
// расхождение падает ощутимо), иначе координаты не трогаются.

const assert = require("node:assert/strict");
const path = require("node:path");
const core = require(path.join(__dirname, "..", "pages-core.js"));

const close = (got, want, tol, msg) =>
  assert.ok(Math.abs(got - want) <= tol, `${msg}: ${got} ≠ ${want}`);

// сетка «границ участков»: квадраты 40×40
const parcels = [];
for (let gx = 0; gx < 6; gx++)
  for (let gy = 0; gy < 6; gy++) {
    const x = gx * 60, y = gy * 60;
    parcels.push({ ring: [[x, y], [x + 40, y], [x + 40, y + 40], [x, y + 40]] });
  }
// «выгрузка портала»: те же границы, сдвинутые на (2.4, −1.7)
const DX = 2.4, DY = -1.7;
const makeOgd = () => parcels.slice(0, 20).map(p => ({
  line: p.ring.map(([x, y]) => [x + DX, y + DY]) }));

// ---------- вектор находится и подтверждается ----------
{
  const ogd = makeOgd();
  const fit = core.computeEgrnAlign(ogd, parcels, { minPairs: 15 });
  assert.ok(fit.ok, `привязка должна подтвердиться: ${fit.reason || ""}`);
  close(fit.dx, -DX, 0.05, "вектор X (обратный сдвигу)");
  close(fit.dy, -DY, 0.05, "вектор Y");
  assert.ok(fit.medAfter < fit.medBefore * 0.5, "остатки падают кратно");
  core.shiftFeaturesInPlace(ogd, fit.dx, fit.dy);
  close(ogd[0].line[0][0], 0, 0.05, "координаты сели на ЕГРН");
}

// ---------- защита: сдвига нет — не трогаем ----------
{
  const same = parcels.slice(0, 20).map(p => ({ line: p.ring.map(pt => [...pt]) }));
  const fit = core.computeEgrnAlign(same, parcels, { minPairs: 15 });
  assert.ok(!fit.ok && fit.reason === "сдвига нет", "нулевой сдвиг не применяется");
}

// ---------- защита: несистемный разброс не подтверждается ----------
{
  // каждая линия смещена в СЛУЧАЙНУЮ сторону — систематики нет
  let flip = 1;
  const noisy = parcels.slice(0, 20).map(p => {
    flip = -flip;
    return { line: p.ring.map(([x, y]) => [x + 3 * flip, y - 3 * flip]) };
  });
  const fit = core.computeEgrnAlign(noisy, parcels, { minPairs: 15 });
  assert.ok(!fit.ok, `разнонаправленный разброс не должен давать сдвига: ${JSON.stringify(fit)}`);
}

// ---------- защита: огромный сдвиг неправдоподобен ----------
{
  const far = parcels.slice(0, 20).map(p => ({ line: p.ring.map(([x, y]) => [x + 30, y]) }));
  const fit = core.computeEgrnAlign(far, parcels, { minPairs: 15 });
  assert.ok(!fit.ok, "30 м — не локальная поправка");
}

// ---------- проводка ----------
{
  const fs = require("node:fs");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "pages-adapter.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(adapter, /payload\.alignOgd !== false/, "флаг уважается");
  assert.match(adapter, /ГИС ОГД посажен на ЕГРН: сдвиг/, "поправка объявляется в примечании");
  assert.match(adapter, /bboxKm2\(bbox\) <= 12/, "тихий запрос ЕГРН только в пределах НСПД-лимита");
  assert.match(app, /alignOgd: state\.alignOgd !== false,/, "настройка хранится в проекте");
  assert.match(app, /id="pcrs-align"/, "переключатель в диалоге СК проекта");
}

console.log("egrn-align: OK");
