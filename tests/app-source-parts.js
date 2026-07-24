"use strict";

// Части, на которые разрезан холст, в порядке загрузки. Единственный список:
// им пользуются и app-source.js (склейка для поиска по коду), и проверки,
// которым нужен КАЖДЫЙ файл по отдельности. Порядок обязан совпадать с
// порядком тегов в index.html — это стережёт split-integrity.test.js.
module.exports = [
  "app.js", "app-sources.js", "app-geodesy.js", "app-geom.js", "app-render.js",
  "app-labels-place.js", "app-history.js", "app-tep.js", "app-layer-panel.js",
  "app-layer-ui.js", "app-dialogs.js", "app-geom-edit.js", "app-input.js",
  "app-shell.js",
];
