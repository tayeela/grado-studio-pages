"use strict";

// Устойчивость к недоступным внешним источникам — дважды отложенный пункт
// аудита. Внешний хост из RU-сети может не отказать, а ПОВИСНУТЬ: без
// таймаута диалог «Данные» ждал бы вечно. Что здесь важно:
// 1. Таймаут обрывает висящий запрос и называет ИСТОЧНИК, а не URL.
// 2. Сетевая ошибка не доходит до человека как «Failed to fetch», и — важнее —
//    причина НАЗЫВАЕТСЯ ПО ЗАМЕРУ, а не по догадке. Голый TypeError от fetch
//    покрывает и обрыв, и CORS, и блокировку, и падение DNS; раньше мы всегда
//    отвечали «недоступен из вашей сети (блокировка или нет соединения)», и
//    человек с исправной сетью, у которого НСПД открыт в соседней вкладке, шёл
//    чинить сеть. Теперь достижимость хоста проверяется пробой.
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
    nativeFetch: fetchImpl, AbortController, AbortSignal, TypeError, URL,
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

  // 2а. хост НЕ откликается и на пробу — тогда сеть винить можно
  {
    const externalFetch = makeContext(() => Promise.reject(new TypeError("Failed to fetch")));
    await assert.rejects(
      () => externalFetch("ГИС ОГД (каталог)", "https://gisogd.example/api/x", {}),
      /ГИС ОГД \(каталог\) не отвечает: gisogd\.example не откликается из вашей сети/,
      "«Failed to fetch» не должен доходить до человека");
  }

  // 2б. хост на пробу ОТВЕЧАЕТ — значит сеть до него есть, и обвинять её нельзя.
  // Рвётся оба раза: повтор проходит, но тоже падает — тогда честная причина.
  {
    let рабочих = 0, проб = 0;
    const externalFetch = makeContext(url => url.includes("/api/")
      ? (рабочих++, Promise.reject(new TypeError("Failed to fetch")))
      : (проб++, Promise.resolve({ ok: false, status: 0, type: "opaque" })));
    await assert.rejects(
      () => externalFetch("НСПД", "https://nspd.gov.ru/api/geoportal/v1/intersects", {}),
      /НСПД: соединение оборвалось на полпути — сеть до nspd\.gov\.ru есть/,
      "нельзя объявлять сеть виновной, когда хост на пробу отвечает: " +
      "именно на это пожаловался человек, у которого НСПД открыт в соседней вкладке");
    assert.equal(проб > 0, true, "проба достижимости обязана выполняться, а не подразумеваться");
    assert.equal(рабочих, 2, "обрыв при живом хосте обязан пережить один повтор");
  }

  // 2в. обрыв разовый — повтор проходит, и человек ничего не замечает
  {
    let рабочих = 0;
    const externalFetch = makeContext(url => url.includes("/api/")
      ? (++рабочих === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ ok: true, status: 200 }))
      : Promise.resolve({ ok: false, status: 0, type: "opaque" }));
    const r = await externalFetch("НСПД", "https://nspd.gov.ru/api/x", {});
    assert.equal(r.status, 200, "разовый обрыв портала не должен доходить до человека");
    assert.equal(рабочих, 2);
  }

  // 2г. повтор ровно один — иначе мёртвый источник растянет ожидание втрое
  {
    let рабочих = 0;
    const externalFetch = makeContext(url => url.includes("/api/")
      ? (рабочих++, Promise.reject(new TypeError("Failed to fetch")))
      : Promise.resolve({ ok: false, status: 0, type: "opaque" }));
    await assert.rejects(() => externalFetch("НСПД", "https://nspd.gov.ru/api/x", {}));
    assert.equal(рабочих, 2, "повторов должно быть ровно один, а не бесконечная цепочка");
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
    const app = require("./app-source");
    for (const name of ["НСПД", "ГИС ОГД (каталог)"])
      assert.ok(adapter.includes(name), `источник «${name}» обязан называться по имени`);
    // Имя зеркала Overpass теперь берётся из URL, а не из зашитого списка:
    // зеркал два, и прежняя проверка `url.includes("mail.ru") ? A : B` называла
    // вторым ЛЮБОЕ незнакомое зеркало, включая третье, если бы его добавили.
    assert.match(adapter, /`Overpass \(\$\{new URL\(url\)\.host\}\)`/,
      "имя зеркала обязано браться из его же адреса");
    assert.match(adapter, /не отвечает ни с одного зеркала/,
      "сообщение обязано называть ВСЕ зеркала: прежнее показывало только " +
      "последнее, и выходило, что виновата kumi.systems, хотя не дались оба");
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
