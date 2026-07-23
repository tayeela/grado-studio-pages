"use strict";

// Устойчивость к недоступным внешним источникам — дважды отложенный пункт
// аудита. Внешний хост из RU-сети может не отказать, а ПОВИСНУТЬ: без
// таймаута диалог «Данные» ждал бы вечно. Что здесь важно:
// 1. Таймаут обрывает висящий запрос и называет ИСТОЧНИК, а не URL.
// 2. Сетевая ошибка превращается в «недоступен из вашей сети», а не в
//    техническое «Failed to fetch».
// 3. Отмена пользователя остаётся отменой — её нельзя перекрашивать в сбой.
// 4. Тайлы: десять провалов без единого успеха — одно предупреждение;
//    если хоть один тайл пришёл, сеть жива и предупреждать не о чем.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");

// ---------- вырезаем externalFetch с подставным nativeFetch ----------
const start = adapter.indexOf("  const EXTERNAL_TIMEOUT_MS");
const end = adapter.indexOf("  const OVERPASS_URLS");
assert.ok(start > 0 && end > start, "обёртка обязана оставаться извлекаемой");

function makeContext(fetchImpl) {
  const context = vm.createContext({
    nativeFetch: fetchImpl, AbortController, AbortSignal, TypeError,
    setTimeout, clearTimeout, Math,
  });
  vm.runInContext(adapter.slice(start, end), context);
  return vm.runInContext("externalFetch", context);
}

const hang = signal => new Promise((_, reject) => {
  const onAbort = () => reject(Object.assign(new TypeError("aborted"), { name: "AbortError" }));
  if (signal) signal.addEventListener("abort", onAbort);
});

(async () => {
  // 1. висящий хост обрывается таймаутом с именем источника
  {
    const externalFetch = makeContext((url, options) => hang(options.signal));
    await assert.rejects(
      () => externalFetch("НСПД", "https://x", {}, 120),
      /НСПД не ответил за 0 с — попробуйте позже|НСПД не ответил/,
      "таймаут обязан называть источник");
  }

  // 2. сетевой отказ — человеческая фраза
  {
    const externalFetch = makeContext(() => Promise.reject(new TypeError("Failed to fetch")));
    await assert.rejects(
      () => externalFetch("ГИС ОГД (каталог)", "https://x", {}),
      /ГИС ОГД \(каталог\) недоступен из вашей сети/,
      "«Failed to fetch» не должен доходить до человека");
  }

  // 3. HTTP-ошибка называет источник и код
  {
    const externalFetch = makeContext(() => Promise.resolve({ ok: false, status: 504 }));
    await assert.rejects(() => externalFetch("Overpass (kumi.systems)", "https://x", {}),
      /Overpass \(kumi\.systems\): сервер ответил HTTP 504/);
  }

  // 4. отмена пользователя остаётся отменой
  {
    const externalFetch = makeContext((url, options) => hang(options.signal));
    const user = new AbortController();
    const call = externalFetch("НСПД", "https://x", { signal: user.signal }, 5000);
    user.abort();
    await assert.rejects(() => call, error =>
      !/не ответил|недоступен/.test(error.message),
      "отмену нельзя перекрашивать в сбой источника");
  }

  // 5. успешный ответ проходит как есть
  {
    const externalFetch = makeContext(() => Promise.resolve({ ok: true, status: 200, tag: "x" }));
    const response = await externalFetch("НСПД", "https://x", {});
    assert.equal(response.tag, "x");
  }

  // ---------- проводка ----------
  {
    const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
    for (const name of ["НСПД", "ГИС ОГД (каталог)", "Overpass (kumi.systems)"])
      assert.ok(adapter.includes(name), `источник «${name}» обязан называться по имени`);
    assert.match(adapter, /externalFetch\(`ГИС ОГД \(слой \$\{code\}\)`/,
      "у тяжёлого слоя ОГД свой длинный таймаут");
    assert.doesNotMatch(adapter, /await nativeFetch\(NSPD_EXTENT_URL/,
      "внешние вызовы не должны ходить мимо обёртки");
    // тайлы
    assert.match(app, /const _tileHealth = \{ ok: 0, failed: 0, warned: false \};/);
    assert.match(app, /_tileHealth\.ok > 0 \|\| _tileHealth\.failed < 10/,
      "предупреждение — только при десяти провалах без единого успеха");
    assert.match(app, /_tileHealth\.ok = 0; _tileHealth\.failed = 0; _tileHealth\.warned = false;/,
      "смена источника сбрасывает счётчики — другой хост, другая судьба");
  }

  console.log("external-resilience: OK");
})().catch(error => { console.error(error); process.exit(1); });
