"use strict";

// Встроенная библиотека знаков (styles-lib.js) обязана побайтово совпадать
// со styles.json: источник правды один, расходятся — знаки на холсте и в
// таблице «код ЛГР → знак» начнут жить разной жизнью.
// Перегенерация после правки styles.json:
//   cd <репо> && python -c "import io,json; lib=json.load(io.open('styles.json',encoding='utf-8')); io.open('styles-lib.js','w',encoding='utf-8',newline='\n').write(io.open('styles-lib.js',encoding='utf-8').read().split('window.GRADO_STYLES_LIB')[0] + 'window.GRADO_STYLES_LIB = ' + json.dumps(lib,ensure_ascii=False,separators=(',',':')) + ';\n')"

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const json = JSON.parse(fs.readFileSync(path.join(root, "styles.json"), "utf8"));
const libSrc = fs.readFileSync(path.join(root, "styles-lib.js"), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(libSrc, context);
const embedded = vm.runInContext("window.GRADO_STYLES_LIB", context);

assert.equal(JSON.stringify(embedded), JSON.stringify(json),
  "styles-lib.js разошёлся со styles.json — перегенерируйте (команда в шапке теста)");
assert.ok(Object.keys(embedded).length >= 150, "библиотека не пустая");
assert.equal(embedded["lgr.kl.uds"].lgr_code, 1, "КЛ УДС на месте с кодом 1");

// проводка: подключено до app.js, а конвейеры берут встроенную первой
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(html.indexOf("styles-lib.js") < html.indexOf('src="./app.js'),
  "styles-lib.js обязан грузиться раньше app.js");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.match(app, /GRADO_STYLES_LIB\)\r?\n\s*for \(const id of Object.keys\(GRADO_STYLES_LIB\)\)/,
  "initStyles вливает встроенную библиотеку до сети");
const adapter = fs.readFileSync(path.join(root, "pages-adapter.js"), "utf8");
assert.match(adapter, /window\.GRADO_STYLES_LIB && !lgrStylesPromise/,
  "ensureLgrStyles берёт встроенную библиотеку без сети");

console.log("styles-lib-sync: OK");
