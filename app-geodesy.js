// ГРАДО Студия · часть 3 из 14 (грузится после app-sources.js).
// координаты, сетка, подложка XYZ, проектная система координат
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- координаты ----------
function w2s(x, y) { return [state.view.tx + x * state.view.k, state.view.ty - y * state.view.k]; }
function s2w(sx, sy) { return [(sx - state.view.tx) / state.view.k, (state.view.ty - sy) / state.view.k]; }
// Все кольца объекта РЕФЕРЕНСАМИ (мутация на месте работает): у полигона —
// внешний контур + дыры, у линии — сама линия. Нужно, чтобы дыры участвовали
// в редактировании (ручки, перетаскивание вершин, перемещение/трансформации):
// раньше вся правка шла по featurePts = только внешнее кольцо, и у выколотого
// полигона вершины дыр не выделялись, а при перемещении дыры оставались на месте.
function featureRings(f) {
  if (f.ring) return f.holes && f.holes.length ? [f.ring, ...f.holes] : [f.ring];
  if (f.line) return [f.line];
  return [];
}
// Адрес плоского индекса вершины (0..внешнее−1, дальше дыры) → {arr, i}.
function vertexRef(f, vi) {
  for (const r of featureRings(f)) {
    if (vi < r.length) return { arr: r, i: vi };
    vi -= r.length;
  }
  return null;
}
// Все редактируемые точки объекта РЕФЕРЕНСАМИ плоским списком (внешний контур +
// дыры). flat() поверхностный — элементы те же ссылки на точки, поэтому мутация
// доходит до колец. Для дуги/окружности — featurePts (как было). Нужно, чтобы
// перемещение/трансформации двигали и дыры, а не только внешний контур.
function featureMovablePts(f) {
  const rings = featureRings(f);
  return rings.length ? rings.flat() : featurePts(f);
}
function featurePts(f) {
  if (f.ring || f.line) return f.ring || f.line;
  if (f.arc) {
    const a = f.arc; const n=8; const pts=[];
    for(let i=0;i<=n;i++){ const ang=a.a0 + a.sweep*i/n; pts.push([a.cx + a.r*Math.cos(ang), a.cy + a.r*Math.sin(ang)]); }
    return pts;
  }
  if (f.circle) {
    const c = f.circle;
    // center + cardinal points for handles (esp east for radius)
    return [
      [c.cx, c.cy],
      [c.cx + c.r, c.cy],
      [c.cx, c.cy + c.r],
      [c.cx - c.r, c.cy],
      [c.cx, c.cy - c.r]
    ];
  }
  return f.point ? [f.point] : [];
}
// экранные углы дуги для ctx.arc: мир Y-вверх, canvas Y-вниз → углы негируются,
// направление обхода инвертируется (мировой sweep>0 = anticlockwise на экране).
// Без этого дуга рисовалась зеркально (выгибалась не туда, мимо средней точки).
function arcScreenArgs(a) { return [-a.a0, -(a.a0 + a.sweep), a.sweep > 0]; }
function selectedFeature() { return state.features.find(x => x.id === state.selected); }
// множественное выделение: selectedIds — источник истины, selected — «первичный»
// (одиночный) объект для правки вершин и детальной панели свойств.
function selectionIds() { return [...(state.selectedIds || [])]; }
function selectionFeatures() {
  const s = state.selectedIds || new Set();
  return state.features.filter(f => s.has(f.id));
}
function selectOne(id) {
  state.selected = id;
  state.selectedIds = id == null ? new Set() : new Set([id]);
}
function clearSelection() { state.selected = null; state.selectedIds = new Set(); state.hoverIdentifyId = null; }
function setSelection(ids) {
  state.selectedIds = new Set(ids);
  state.selected = ids.length === 1 ? ids[0] : null;
}
function toggleSelection(id) {
  const s = state.selectedIds = new Set(state.selectedIds || []);
  if (s.has(id)) s.delete(id); else s.add(id);
  state.selected = s.size === 1 ? [...s][0] : null;
}
function vertexAt(f, wx, wy) {
  const tolW = 8 / state.view.k;
  if (f.arc) {
    const a = f.arc;
    const s = [a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)];
    const e = [a.cx + a.r * Math.cos(a.a0 + a.sweep), a.cy + a.r * Math.sin(a.a0 + a.sweep)];
    if (Math.hypot(s[0] - wx, s[1] - wy) < tolW) return 0; // start
    if (Math.hypot(e[0] - wx, e[1] - wy) < tolW) return 1; // end
    // center
    if (Math.hypot(a.cx - wx, a.cy - wy) < tolW) return 2;
    // любая точка на дуге — редактирование радиуса (логика редактирования дуг)
    const pts = featurePts(f);
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - wx, pts[i][1] - wy) < tolW) return 3;
    }
    return null;
  }
  if (f.circle) {
    const c = f.circle;
    if (Math.hypot(c.cx - wx, c.cy - wy) < tolW) return 0; // center
    // radius handle point (east)
    const rp = [c.cx + c.r, c.cy];
    if (Math.hypot(rp[0] - wx, rp[1] - wy) < tolW) return 1;
    return null;
  }
  // все кольца (внешний контур + дыры) плоским индексом: 0..внешнее−1, затем
  // вершины дыр — так вершину дыры можно схватить и тянуть/удалить
  let flat = 0;
  for (const ring of featureRings(f)) {
    for (let i = 0; i < ring.length; i++) {
      if (Math.hypot(ring[i][0] - wx, ring[i][1] - wy) < tolW) return flat + i;
    }
    flat += ring.length;
  }
  return null;
}

// Совместное редактирование границ покрытия: вершины других зон,
// совпадающие с данной, двигаются вместе с ней — общая граница остаётся
// общей, дырки и нахлёсты не возникают (инвариант coverage ядра).
// Кто участвует — решает флаг слоя topology="coverage", не тип объекта.
// Режим включается кнопкой «Общие границы» и по умолчанию выключен: границы,
// зоны и ограничения помечены покрытием почти все, поэтому невыключаемое
// поведение утаскивало соседний полигон при любом перемещении.
function isCoverageFeature(f) {
  if (!state.topoEdit) return false;
  const L = layerOf(f);
  return !!L && L.topology === "coverage";
}
function sharedCompanions(f, vi) {
  if (!isCoverageFeature(f)) return [];
  // общие границы — только у ВНЕШНЕГО контура; вершина дыры компаньонов не имеет
  const outer = featurePts(f);
  if (!outer || vi >= outer.length) return [];
  const [x, y] = outer[vi];
  const out = [];
  for (const other of state.features) {
    if (other.id === f.id || !isCoverageFeature(other) || isHidden(other)) continue;
    const pts = featurePts(other);
    for (let i = 0; i < pts.length; i++)
      if (Math.abs(pts[i][0] - x) < 1e-6 && Math.abs(pts[i][1] - y) < 1e-6)
        out.push({ f: other, vi: i });
  }
  return out;
}

// тянем ребро целиком (общая граница): оба конца на общий офсет от захвата +
// совпадающие вершины соседних coverage-зон (companions) следом
function applyEdgeDrag(ed, wx, wy) {
  const raw = ed.f.ring || ed.f.line;
  const ox = wx - ed.grab[0], oy = wy - ed.grab[1];
  raw[ed.i0][0] = ed.orig0[0] + ox; raw[ed.i0][1] = ed.orig0[1] + oy;
  raw[ed.i1][0] = ed.orig1[0] + ox; raw[ed.i1][1] = ed.orig1[1] + oy;
  for (const c of ed.comps0) { const cp = featurePts(c.f); cp[c.vi][0] = raw[ed.i0][0]; cp[c.vi][1] = raw[ed.i0][1]; }
  for (const c of ed.comps1) { const cp = featurePts(c.f); cp[c.vi][0] = raw[ed.i1][0]; cp[c.vi][1] = raw[ed.i1][1]; }
}
function sharedVertexSet(f) {
  const shared = new Set();
  if (!isCoverageFeature(f)) return shared;
  const pts = featurePts(f);
  for (let i = 0; i < pts.length; i++)
    if (sharedCompanions(f, i).length) shared.add(i);
  return shared;
}

// Safari отмечен глюками ResizeObserver + <canvas>: назначение canvas.width
// сбрасывает битмап, и если наблюдатель перевызывает resize() синхронно
// в цикле (даже когда CSS-размер элемента фактически не изменился),
// холст может гаситься быстрее, чем успевает перерисоваться — экран
// «на секунду показывает точки сетки и белеет». Защита: (1) менять
// битмап только когда размер реально изменился; (2) события наблюдателя
// схлопывать через requestAnimationFrame, чтобы разорвать возможный
// синхронный цикл переисчисления layout.
let lastBufW = 0, lastBufH = 0;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (w === lastBufW && h === lastBufH) { draw(); return; }
  lastBufW = w; lastBufH = h;
  cv.width = w; cv.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.features.length && !state._fitted) {
    state._fitted = true;
    fitView();
    return;
  }
  draw();
}
window.addEventListener("resize", resize);
let roPending = false;
new ResizeObserver(() => {
  if (roPending) return;
  roPending = true;
  requestAnimationFrame(() => { roPending = false; resize(); });
}).observe(cv);

// ---------- сетка ----------
// Авто-шаг: первый из ряда, дающий на экране >= 22 px. Ряд расширен в обе
// стороны под новые пределы зума (K_MIN/K_MAX): без мелких ступеней сетка на
// приближении застревала на 1 м (одна линия через пол-экрана), без крупных —
// на отдалении вырождалась в сплошную кашу с шагом 10 px. На привычных зумах
// выбор не изменился (напр. k≈1 → по-прежнему 50 м).
function gridStep() {
  if (state.gridMode !== "auto") return +state.gridMode;
  for (const g of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000])
    if (g * state.view.k >= 22) return g;
  return 10000;
}

// ---------- подложка (тайлы XYZ) ----------
// Геометрия проекта хранится в точных метрах EPSG:32637−ORIGIN. Подложка,
// экстент и импорты обязаны использовать ту же проекцию: линейное
// «метров на градус» не учитывает сближение меридианов и сдвигает тайлы
// по востоку/западу при удалении от точки ORIGIN.
const exactCrs = window.GRADO_CRS;

// ---------- проектная система координат ----------
// Проект живёт в местной СК своей территории: Москва — МСК Москвы, область —
// МСК-50, дальше — зоны Гаусса-Крюгера СК-42. Все загрузки автоматически
// перепроецируются в СК проекта (конвейер единый — exactCrs), лист получает
// честный масштаб (k=1 у местных СК против 0.9996 у UTM), а DXF — настоящие
// координаты системы, в которой работают САПРы получателей.
const PROJECT_CRS_CHOICES = [
  { id: "utm37-legacy", title: "UTM 37N (историческая, по умолчанию у старых проектов)",
    origin: [413000, 6178000], legacy: true },
  { id: "msk-moscow", title: "МСК Москвы", origin: [0, 0] },
  { id: "msk50-2", title: "МСК-50 зона 2 (Московская область)", origin: [2250000, 480000] },
  ...[6, 7, 8].map(z => ({ id: "gk" + z, title: `Гаусса-Крюгера зона ${z} (СК-42)`,
    origin: [z * 1e6 + 500000, 6170000] })),
];
function projectCrsEntry(id) {
  return PROJECT_CRS_CHOICES.find(item => item.id === id) || PROJECT_CRS_CHOICES[0];
}
function projectCrsConverters(entry) {
  if (entry.legacy) return null;                      // встроенная UTM37 в crs.js
  const R = window.GRADO_CRS_RU;
  const def = (R.KNOWN.find(k => k.id === entry.id) || {}).def;
  if (!def) return null;
  const [ox, oy] = entry.origin;
  return {
    id: entry.id,
    fromWgs84: ([lon, lat]) => {
      const [x, y] = R.fromWgs84(lon, lat, def);
      return [x - ox, y - oy];
    },
    toWgs84: ([x, y]) => R.toWgs84(x + ox, y + oy, def),
  };
}
// пересчёт всех координат проекта из СК в СК; история очищается: снимки
// прошлой СК рядом с новой геометрией дали бы кашу после Undo
function applyProjectCrs(id, { reproject = true, silent = false } = {}) {
  const entry = projectCrsEntry(id);
  const current = state.projectCrsId || "utm37-legacy";
  if (entry.id === current && reproject) return false;
  const convert = pt => exactCrs.wgs84ToLocal(exactCrs.localToWgs84(pt));
  let viewCenter = null;
  if (reproject) {
    try { viewCenter = s2w(viewportW() / 2, viewportH() / 2); } catch (e) {}
    // сначала запоминаем WGS84-положение всего, ПОТОМ включаем новую СК
    const staged = [];
    for (const f of state.features) {
      if (f.circle) staged.push([f, "c", exactCrs.localToWgs84([f.circle.cx, f.circle.cy])]);
      else if (f.arc) staged.push([f, "a", exactCrs.localToWgs84([f.arc.cx, f.arc.cy])]);
      else for (const p of featureMovablePts(f)) staged.push([p, "p", exactCrs.localToWgs84(p)]);
    }
    const viewWgs = viewCenter ? exactCrs.localToWgs84(viewCenter) : null;
    const sheetHook = typeof window.reprojectSheet === "function"
      ? window.reprojectSheet(pt => exactCrs.localToWgs84(pt)) : null;
    exactCrs.setProjectCrs(projectCrsConverters(entry));
    for (const [target, kindTag, wgs] of staged) {
      const [x, y] = exactCrs.wgs84ToLocal(wgs);
      if (kindTag === "p") { target[0] = x; target[1] = y; }
      else if (kindTag === "c") { target.circle.cx = x; target.circle.cy = y; }
      else { target.arc.cx = x; target.arc.cy = y; }
    }
    if (sheetHook) sheetHook(wgs => exactCrs.wgs84ToLocal(wgs));
    if (viewWgs && viewCenter) {
      const [nx, ny] = exactCrs.wgs84ToLocal(viewWgs);
      state.view.tx += (viewCenter[0] - nx) * state.view.k;
      state.view.ty -= (viewCenter[1] - ny) * state.view.k;
    }
    state.undo = []; state.redo = [];
  } else {
    exactCrs.setProjectCrs(projectCrsConverters(entry));
  }
  state.projectCrsId = entry.id;
  state._ix = null; state._snapIndex = null;
  if (typeof syncHistoryControls === "function") syncHistoryControls();
  if (!silent) {
    persist();
    draw(); renderLayers(); renderProps();
    toast(`Система координат проекта: ${entry.title}${reproject ? " — все слои перепроецированы" : ""}`);
  }
  return true;
}
// авто: местная СК подбирается по территории при первой загрузке геоданных
function resolveAutoProjectCrs() {
  if ((state.projectCrsId || "auto") !== "auto") return;
  const geo = state.features.find(f => f.prov || String(f.layer_id || "").startsWith("source."));
  if (!geo) return;
  let lon, lat;
  try {
    const pts = geo.circle ? [[geo.circle.cx, geo.circle.cy]]
      : geo.arc ? [[geo.arc.cx, geo.arc.cy]] : featureMovablePts(geo);
    [lon, lat] = exactCrs.localToWgs84(pts[0]);
  } catch (e) { return; }
  // Москва (с ТиНАО) → МСК Москвы; Подмосковье в полосе зоны 2 → МСК-50-2;
  // дальше — зона Гаусса-Крюгера СК-42 по долготе
  const id = lon >= 36.7 && lon <= 38.1 && lat >= 55.05 && lat <= 56.1 ? "msk-moscow"
    : lon >= 35.0 && lon <= 40.6 && lat >= 54.2 && lat <= 57.0 ? "msk50-2"
    : (() => { const z = Math.floor(lon / 6) + 1; return z >= 6 && z <= 8 ? "gk" + z : "utm37-legacy"; })();
  applyProjectCrs(id, { reproject: true });
}
function openProjectCrsDialog() {
  closePopups();
  const currentId = state.projectCrsId === "auto" ? "auto" : projectCrsEntry(state.projectCrsId).id;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal find-modal" role="dialog" aria-modal="true" aria-labelledby="pcrs-title">
    <div class="modal-head modal-head-rich"><div class="modal-head-copy"><span class="modal-kicker">Проект</span><span id="pcrs-title">Система координат проекта</span></div>
      <button class="modal-x" aria-label="Закрыть выбор системы координат"><svg class="ic"><use href="#ic-close"/></svg></button></div>
    <div class="modal-body select-body">
      <p class="vector-intro">Все слои и загрузки живут в местной системе территории и
        перепроецируются автоматически; DXF выгружается в её настоящих координатах.
        Смена системы пересчитывает весь проект и очищает историю отмен.</p>
      <label class="select-row">Система координат<select id="pcrs-pick">
        <option value="auto"${currentId === "auto" ? " selected" : ""}>Автоматически по территории</option>
        ${PROJECT_CRS_CHOICES.map(item =>
          `<option value="${item.id}"${item.id === currentId ? " selected" : ""}>${escHtml(item.title)}</option>`).join("")}
      </select></label>
      <label class="chk"><input type="checkbox" id="pcrs-align"${state.alignOgd !== false ? " checked" : ""}>
        Датум-поправка ГИС ОГД (портал публикует координаты со сдвигом ≈7,4 м от ЕГРН
        и спутника; поправка −5,0/+5,45 м сажает их на место — по умолчанию включена)</label>
    </div>
    <div class="modal-actions"><span class="spacer"></span>
      <button type="button" id="pcrs-cancel">Отмена</button>
      <button type="button" id="pcrs-apply" class="primary">Применить</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#pcrs-cancel").addEventListener("click", close);
  overlay.querySelector(".modal-x").addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  overlay.querySelector("#pcrs-apply").addEventListener("click", () => {
    const value = overlay.querySelector("#pcrs-pick").value;
    state.alignOgd = overlay.querySelector("#pcrs-align").checked;
    close();
    if (value === "auto") {
      state.projectCrsId = "auto";
      resolveAutoProjectCrs();
      if (state.projectCrsId === "auto") toast("СК подберётся при первой загрузке геоданных");
      persist();
      return;
    }
    applyProjectCrs(value, { reproject: true });
  });
}
on("btn-project-crs", "click", openProjectCrsDialog);
window.openProjectCrsDialog = openProjectCrsDialog;
window.applyProjectCrs = applyProjectCrs;
window.projectCrsInfo = () => {
  const entry = projectCrsEntry(state.projectCrsId || "utm37-legacy");
  return { id: entry.id, title: entry.title, origin: entry.origin };
};
if (!exactCrs) throw new Error("Не загружен модуль точных преобразований координат");
const basemap = {
  on: false, source: "osm", opacity: 0.85, originLon: null, originLat: null,
  attribution: "", attributions: {},
  cache: new Map(),   // "src/z/x/y" -> {img, loaded, failed}
};

async function initBasemap() {
  try {
    const r = await fetch("/api/basemap-info");
    const d = await r.json();
    basemap.originLon = d.origin_lon;
    basemap.originLat = d.origin_lat;
    basemap.attributions = d.attributions || { osm: d.attribution };
    basemap.attribution = basemap.attributions[basemap.source] || d.attribution;
  } catch (e) { /* сервер без /api/basemap-info — подложка недоступна */ }
}

// переключение источника подложки (карта OSM ↔ спутник ESRI): чужие тайлы
// из кэша убираем, подпись — по источнику
function setBasemapSource(src) {
  basemap.source = src;
  basemap.attribution = basemap.attributions[src] || basemap.attribution;
  basemap.cache.clear();
  _tileHealth.ok = 0; _tileHealth.failed = 0; _tileHealth.warned = false;
  draw();
}

function localToLonLat(x, y) {
  return exactCrs.localToWgs84([x, y]);
}
function lonLatToLocal(lon, lat) {
  return exactCrs.wgs84ToLocal([lon, lat]);
}
function lonToTileX(lon, z) { return (lon + 180) / 360 * 2 ** z; }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
}
function tileXToLon(tx, z) { return tx / 2 ** z * 360 - 180; }
function tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Кэш тайлов был безлимитным и чистился только при смене подложки. За долгую
// сессию с панорамированием по городу он накапливал тысячи декодированных
// Image (~256 КБ битмапа каждый) — сотни мегабайт, вкладка тяжелела.
// Map хранит порядок вставки, поэтому LRU обходится переустановкой ключа при
// обращении и удалением самого старого при переполнении.
const TILE_CACHE_MAX = 800;   // ~200 МБ битмапов в худшем случае
function tileImage(z, x, y) {
  const key = `${basemap.source}/${z}/${x}/${y}`;
  let e = basemap.cache.get(key);
  if (e) {
    // обращение — освежаем позицию в порядке вытеснения
    basemap.cache.delete(key);
    basemap.cache.set(key, e);
    // неудачный тайл больше не «залипает» навсегда: даём повторную попытку
    if (e.failed) {
      e.failed = false; e.loaded = false;
      e.img = new Image();
      e.img.onload = () => { e.loaded = true; draw(); };
      e.img.onerror = () => { e.failed = true; };
      e.img.src = tileUrl(z, x, y);
    }
    return e;
  }
  e = { img: new Image(), loaded: false, failed: false };
  e.img.onload = () => { e.loaded = true; _tileHealth.ok += 1; draw(); };
  e.img.onerror = () => { e.failed = true; reportTileFailure(); };
  e.img.src = tileUrl(z, x, y);
  basemap.cache.set(key, e);
  while (basemap.cache.size > TILE_CACHE_MAX) {
    const oldest = basemap.cache.keys().next().value;
    if (oldest === key) break;
    basemap.cache.delete(oldest);
  }
  return e;
}
// Тайлы падают молча: битая картинка просто не рисуется, и человек видит
// пустую подложку без объяснения. Считаем провалы; десять подряд без единого
// успешного — говорим один раз про источник и сеть.
const _tileHealth = { ok: 0, failed: 0, warned: false };
function reportTileFailure() {
  _tileHealth.failed += 1;
  if (_tileHealth.warned || _tileHealth.ok > 0 || _tileHealth.failed < 10) return;
  _tileHealth.warned = true;
  const source = basemap.source === "osm" ? "OSM (tile.openstreetmap.org)" : "ESRI (arcgisonline.com)";
  toast(`Тайлы подложки не загружаются: ${source} недоступен из вашей сети. Попробуйте другой источник в панели «Подложка»`, "warn");
}

function tileUrl(z, x, y) {
  return window.gradoTileUrl
    ? window.gradoTileUrl(z, x, y, basemap.source)
    : `/api/tiles/${z}/${x}/${y}.png?src=${basemap.source}`;
}

function drawBasemap(w, h) {
  if (!basemap.on || basemap.originLon == null) return;
  const geoCorners = [[0, 0], [w, 0], [w, h], [0, h]]
    .map(([sx, sy]) => localToLonLat(...s2w(sx, sy)));
  const lons = geoCorners.map(point => point[0]);
  const lats = geoCorners.map(point => point[1]);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  // подбор зума: метры на тайл-пиксель ≈ метры на экранный пиксель
  const mppTile0 = 156543.03392804097 * Math.cos(basemap.originLat * Math.PI / 180);
  let z = Math.round(Math.log2(mppTile0 * state.view.k));
  z = Math.max(1, Math.min(19, z));

  const txMin = Math.floor(lonToTileX(lonMin, z));
  const txMax = Math.floor(lonToTileX(lonMax, z));
  const tyMin = Math.floor(latToTileY(latMax, z));
  const tyMax = Math.floor(latToTileY(latMin, z));
  const maxTiles = 2 ** z;
  const budget = 300;  // защита от случайного запроса тысяч тайлов при рывке зума
  let drawn = 0;
  ctx.save();
  ctx.globalAlpha = basemap.opacity;
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (++drawn > budget) break;
      const cx = ((tx % maxTiles) + maxTiles) % maxTiles;
      if (ty < 0 || ty >= maxTiles) continue;
      const e = tileImage(z, cx, ty);
      if (!e.loaded) continue;
      const nw = lonLatToLocal(tileXToLon(tx, z), tileYToLat(ty, z));
      const ne = lonLatToLocal(tileXToLon(tx + 1, z), tileYToLat(ty, z));
      const sw = lonLatToLocal(tileXToLon(tx, z), tileYToLat(ty + 1, z));
      const p00 = w2s(...nw), p10 = w2s(...ne), p01 = w2s(...sw);
      const iw = e.img.naturalWidth || 256, ih = e.img.naturalHeight || 256;
      // UTM grid north is rotated against geographic north. Three projected
      // corners define the tile affine transform and preserve that convergence.
      ctx.save();
      ctx.transform((p10[0] - p00[0]) / iw, (p10[1] - p00[1]) / iw,
        (p01[0] - p00[0]) / ih, (p01[1] - p00[1]) / ih, p00[0], p00[1]);
      // half-source-pixel bleed hides antialiasing seams between neighbours.
      ctx.drawImage(e.img, -0.5, -0.5, iw + 1, ih + 1);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.fillRect(6, h - 18, ctx.measureText(basemap.attribution).width + 14, 14);
  ctx.fillStyle = "#5c5a54"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(basemap.attribution, 10, h - 7);
}

