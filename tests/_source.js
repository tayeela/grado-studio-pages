"use strict";

// Чтение исходников для детекторов — БЕЗ комментариев.
//
// За одну сессию три детектора подряд поймали собственные объяснения:
// window-lexical-globals споткнулся о «раньше здесь было window.state»,
// design-vocabulary и typography-scale — о «раньше здесь стояло font-size:11px»,
// dock — о «requestAnimationFrame в фоновой вкладке не идёт». Каждый раз это
// выглядело как настоящее нарушение и каждый раз им не было.
//
// Причина одна: детектор ищет в тексте то, что в комментариях как раз и
// объясняют. Значит резать комментарии должен не каждый тест по отдельности,
// а общее место — иначе следующий детектор наступит туда же.
//
// Строки сохраняем: номера в сообщениях об ошибке должны совпадать с файлом.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const пробеламиКромеПереводов = m => m.replace(/[^\n]/g, " ");

/** JS без комментариев (// и то, что между звёздочками), строки сохранены. */
function jsBezKommentariev(текст) {
  return текст
    .replace(/\/\*[\s\S]*?\*\//g, пробеламиКромеПереводов)
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, до) => до + " ".repeat(m.length - до.length));
}

/** CSS без комментариев, строки сохранены. */
function cssBezKommentariev(текст) {
  return текст.replace(/\/\*[\s\S]*?\*\//g, пробеламиКромеПереводов);
}

/** Прочитать файл проекта и снять комментарии по расширению. */
function читатьЧистый(отн) {
  const текст = fs.readFileSync(path.join(ROOT, отн), "utf8");
  if (отн.endsWith(".css")) return cssBezKommentariev(текст);
  if (отн.endsWith(".js")) return jsBezKommentariev(текст);
  return текст;
}

/** Прочитать файл как есть — когда проверяем сами формулировки. */
function читать(отн) {
  return fs.readFileSync(path.join(ROOT, отн), "utf8");
}

module.exports = { ROOT, читать, читатьЧистый, jsBezKommentariev, cssBezKommentariev };
