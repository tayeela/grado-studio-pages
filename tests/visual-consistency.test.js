"use strict";

// Детектор визуальных расхождений (трек A спеки
// docs/superpowers/specs/2026-07-24-slazhennost-i-kachestvo-design.md).
//
// Ощущение «навайбкодено» создаётся не отдельным багом, а КЛАССОМ дефектов,
// который возвращается. Поэтому здесь не проверка конкретных мест, а
// детекторы классов: они находят ВСЕ случаи разом и не дают классу вернуться.
//
// Классы, которые ловим статически (по исходникам, без браузера):
//   1. CSS-переменная используется без объявления и без запасного значения —
//      объявление становится невалидным: у шорткода border это убирает рамку
//      целиком, у font-size откатывает кегль к унаследованному.
//   2. Ссылка на символ иконки, которого нет в спрайте — пустая кнопка.
//   3. Диалог без обязательных частей каркаса (роль, подпись, крестик).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cssFiles = ["tokens.css", "redesign/shell.css", "redesign/studio2.css",
  "redesign/atelier.css", "redesign/layers-studio.css"];
const css = cssFiles.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// ---------- 1. переменные: используются, но не объявлены ----------
{
  // объявления: --имя: значение (в :root, в теме, где угодно)
  const declared = new Set();
  for (const m of (css + html).matchAll(/--([a-z0-9-]+)\s*:/gi)) declared.add(m[1]);

  // использования БЕЗ запасного значения: var(--имя) — запятая означает fallback
  const missing = new Map();
  const scan = (text, label) => {
    for (const m of text.matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/gi)) {
      const name = m[1];
      if (declared.has(name)) continue;
      if (!missing.has(name)) missing.set(name, label);
    }
  };
  scan(css, "css");
  scan(html, "index.html");

  assert.equal(missing.size, 0,
    "CSS-переменные используются без объявления и без запасного значения — " +
    "объявление становится невалидным (у border пропадает рамка, у font-size " +
    `сбивается кегль): ${[...missing.keys()].join(", ")}`);
}

// ---------- 2. иконки: ссылка есть, символа нет ----------
{
  const symbols = new Set();
  for (const m of html.matchAll(/<symbol[^>]*\bid="([^"]+)"/g)) symbols.add(m[1]);
  const broken = new Set();
  for (const m of html.matchAll(/<use[^>]*\bhref="#([^"]+)"/g))
    if (!symbols.has(m[1])) broken.add(m[1]);
  // ссылки из JS (диалоги строятся строками)
  for (const file of fs.readdirSync(root).filter(f => f.endsWith(".js")))
    for (const m of fs.readFileSync(path.join(root, file), "utf8").matchAll(/href="#(ic-[a-z0-9-]+|i-[a-z0-9-]+)"/g))
      if (!symbols.has(m[1])) broken.add(`${m[1]} (${file})`);

  assert.equal(broken.size, 0,
    `ссылки на несуществующие символы иконок — кнопка выходит пустой: ${[...broken].join(", ")}`);
}

// ---------- 3. каркас диалогов ----------
// Каждое модальное окно строится строкой в JS. Общий каркас: роль диалога,
// программная подпись и крестик. Без них окно выпадает из общего ряда и
// недоступно с клавиатуры.
{
  const problems = [];
  for (const file of fs.readdirSync(root).filter(f => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    // ищем разметку модалки: <div class="modal ..."> внутри шаблонной строки
    for (const m of src.matchAll(/<div class="modal ([^"]*)"([^>]*)>/g)) {
      const [, classes, attrs] = m;
      if (/category-style-modal/.test(classes)) continue;   // вложенный редактор знака
      const where = `${file}: .${classes.trim().split(/\s+/).join(".")}`;
      if (!/role="dialog"/.test(attrs)) problems.push(`${where} — нет role="dialog"`);
      if (!/aria-modal="true"/.test(attrs)) problems.push(`${where} — нет aria-modal`);
      // подпись: связка с видимым заголовком либо своя строка. Связка
      // предпочтительнее — невидимый дубликат заголовка со временем
      // расходится с видимым (так и случилось с окном проверки выпуска).
      if (!/aria-labelledby=/.test(attrs) && !/aria-label=/.test(attrs))
        problems.push(`${where} — нет подписи (aria-labelledby или aria-label)`);
    }
  }
  assert.equal(problems.length, 0,
    "диалоги без общего каркаса (недоступны с клавиатуры, выпадают из ряда):\n  " +
    problems.join("\n  "));
}

// ---------- 4. частное правило шапки не ужимает шапку с плашкой ----------
{
  // Шапка с плашкой раздела (.modal-head-rich) выше обычной: над заголовком
  // появляется вторая строка. Окно, задавшее шапке собственную высоту (мастер
  // данных держал 42px), с плашкой получает БОЛЬШЕ содержимого и МЕНЬШЕ места,
  // чем все остальные, — то самое расхождение каркаса, ради которого затеян
  // трек A. Если окно и переопределяет шапку, и показывает плашку, оно обязано
  // переопределить и .modal-head-rich.
  const sources = fs.readdirSync(root).filter(f => /\.(js|html)$/.test(f))
    .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");

  const problems = [];
  for (const m of css.matchAll(/\.([\w-]+)\s+\.modal-head\s*\{([^}]*)\}/g)) {
    const [, scope, body] = m;
    if (!/min-height|height\s*:|padding-bottom/.test(body)) continue;
    // окно с этим классом действительно рисует шапку с плашкой?
    const usesRich = new RegExp(`${scope}[^\`]{0,400}?modal-head-rich`, "s").test(sources);
    if (!usesRich) continue;
    if (!new RegExp(`\\.${scope}\\s+\\.modal-head-rich\\s*\\{`).test(css))
      problems.push(`.${scope}: шапка переопределена (${body.trim().slice(0, 60)}…), ` +
        "а .modal-head-rich — нет: окно с плашкой окажется ниже остальных");
  }
  assert.equal(problems.length, 0,
    "частное правило шапки конфликтует с плашкой раздела:\n  " + problems.join("\n  "));
}

console.log("visual-consistency: OK");
