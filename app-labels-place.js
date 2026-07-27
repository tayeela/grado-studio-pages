// ГРАДО Студия · часть 6 из 14 (грузится после app-render.js).
// размещение подписей объектов
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- размещение подписей объектов ----------
// Занятость мест — ГРИД, а не список. Раньше каждая подпись сверялась ЛИНЕЙНЫМ
// перебором со всеми уже поставленными (`_placed.some(...)`): на городском слое
// в 30 000 зданий с ~3 800 поставленными подписями это ~113 млн проверок
// прямоугольников ЗА КАДР — 93% времени отрисовки (замер: 386 мс с перебором
// против 27 мс без него). Правило размещения не изменилось: greedy, побеждает
// первый занявший место; подпись задевает 1-4 ячейки и сравнивается только с
// соседями по этим ячейкам — результат тот же, что у полного перебора.
// Сетка и раскладка живут в app-labels.js (проверяются в Node); здесь — сборка
// заданий и отрисовка. LABELS объявлен так, чтобы app.js оставался пригодным
// для node-тестов, которые режут из него куски без модуля.
const LABELS = (typeof window !== "undefined" && window.GRADO_LABELS) || null;

// Точка подписи полигона — полюс недоступности, а не среднее вершин: у поймы,
// зоны вдоль набережной и квартала подковой среднее лежит ВНЕ контура, и
// подпись уезжала на соседа. Считается в мировых координатах и кешируется:
// на 30 000 зданий пересчёт каждый кадр невозможен. Ключ кеша — сам массив
// кольца плюс отпечаток (число вершин и крайние точки): правка вершины меняет
// отпечаток, и точка пересчитывается.
const _anchorCache = new WeakMap();
function labelAnchor(f) {
  // Круг — площадная фигура, и точка его подписи очевидна: центр. Полюс
  // недоступности тут считать не из чего (кольца нет), а без якоря подпись
  // уходила в ветку ЛИНИИ и раскладывалась по featurePts — а он для круга
  // отдаёт ручки редактора (центр и четыре стороны света). Подпись круглой
  // зоны в итоге печаталась в углу холста, в точке (0,0).
  if (f.circle) return [f.circle.cx, f.circle.cy];
  const ring = f.ring;
  if (!ring || ring.length < 3) return null;
  const last = ring[ring.length - 1];
  const stamp = `${ring.length}|${ring[0][0]},${ring[0][1]}|${last[0]},${last[1]}`;
  const hit = _anchorCache.get(ring);
  if (hit && hit.stamp === stamp) return hit.at;
  const rings = [ring, ...(f.holes || [])];
  const at = LABELS ? LABELS.poleOfInaccessibility(rings) : null;
  if (at) _anchorCache.set(ring, { stamp, at });
  return at;
}

// Экранный габарит объекта — для отсева подписей, которым негде поместиться.
function featureScreenBox(f) {
  const pts = f.ring || f.line || (f.point ? [f.point] : null)
    || ((f.arc || f.circle) ? featurePts(f) : null);
  if (!pts || !pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const [px, py] = w2s(p[0], p[1]);
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  return [x0, y0, x1, y1];
}

// Задание на подпись: где хочет стоять, насколько важна, куда может подвинуться.
function labelJob(f, st, text, layer) {
  if (!LABELS) return null;
  const lf = st.label_font || {};
  const size = Math.min(72, Math.max(6, lf.size || 11));
  const font = `${size}px ${LABEL_FONTS[lf.family] || "sans-serif"}`;
  // Экранный габарит объекта считаем ДО измерения текста: на общем плане
  // квартал занимает 2 px, подпись туда не влезет никогда, а собрать задание —
  // это измерение, полюс недоступности и место в раскладке. Раньше на 20 000
  // подписанных зданий кадр тратил 73 мс на задания, из которых не ставилось
  // НИ ОДНО.
  const fit = featureScreenBox(f);
  if (!fit) return null;
  // Порог — только для полигонов: у точки габарит нулевой, у горизонтальной
  // линии нулевая высота, а подписывать их надо.
  if (f.ring && (fit[2] - fit[0] < size || fit[3] - fit[1] < size)) return null;
  const width = measureLabel(text, font);
  if (!(width > 0)) return null;
  const color = lf.color || cvColor("label", "#5c5a54");
  // Важность: чем позже слой в LAYERS_V2, тем он выше на чертеже (порядок
  // отрисовки), значит его подпись важнее. Внутри слоя крупный объект
  // вытесняет мелкий. Раньше место занимал тот, кого раньше нарисовали, —
  // подпись фонового слоя выигрывала у подписи верхнего.
  const base = Math.max(0, LAYERS_V2.indexOf(layer)) * 1000;
  if (f.ring || f.circle) {                        // площадные: подпись в теле
    if (width > fit[2] - fit[0]) return null;      // строка шире объекта
    const at = labelAnchor(f);
    if (!at) return null;
    const [sx, sy] = w2s(at[0], at[1]);
    return { text, font, color, size, x: sx, y: sy, width, height: size,
      fit, priority: base + Math.min(999, (fit[2] - fit[0]) * (fit[3] - fit[1]) / 400) };
  }
  if (f.point) {
    const [sx, sy] = w2s(...f.point);
    const marker = (st.marker && st.marker.size) || 4;
    return { text, font, color, size, x: sx, y: sy, width, height: size,
      candidates: LABELS.aroundPoint(marker), priority: base + 500 };
  }
  const pts = f.line || (f.arc ? featurePts(f) : null);   // круг ушёл выше, в площадные
  if (pts && pts.length > 1) {
    // Подпись линии идёт ВДОЛЬ неё — по самому длинному ребру, как подписи
    // улиц на карте. Раньше она стояла горизонтально в середине и на косой
    // линии выглядела чужой.
    let bi = 0, bl = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = w2s(pts[i][0], pts[i][1]);
      const [bx, by] = w2s(pts[i + 1][0], pts[i + 1][1]);
      const l = Math.hypot(bx - ax, by - ay);
      if (l > bl) { bl = l; bi = i; }
    }
    const [ax, ay] = w2s(pts[bi][0], pts[bi][1]);
    const [bx, by] = w2s(pts[bi + 1][0], pts[bi + 1][1]);
    let angle = Math.atan2(by - ay, bx - ax);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;   // не вверх ногами
    // строка длиннее ребра — кладём горизонтально в середину, не растягивая ложь
    const along = width + 8 <= bl;
    return { text, font, color, size,
      x: (ax + bx) / 2, y: (ay + by) / 2, width, height: size,
      angle: along ? angle : 0,
      candidates: along ? null : LABELS.aroundPoint(3), priority: base + 200 };
  }
  return null;
}

// Ручное смещение подписи (label_offset в метрах мира) применяется к готовому
// заданию. Смещённая рукой подпись показывается ВСЕГДА: человек поставил её
// сам — прятать её из-за соседей нельзя, как в QGIS у закреплённых подписей.
function applyLabelOffset(job, f) {
  const off = f.label_offset;
  if (!Array.isArray(off) || (off[0] === 0 && off[1] === 0)) return job;
  job.x += off[0] * state.view.k;
  job.y -= off[1] * state.view.k;
  job.pinned = true;
  job.priority = 1e9;
  return job;
}

// Ореол вокруг текста: подпись читается и поверх заливки зоны, и поверх снимка.
let _labelBoxes = [];                 // подписи прошлого кадра — для перетаскивания
function drawLabelJobs(jobs, grid) {
  if (!LABELS || !jobs.length) { _labelBoxes = []; return; }
  const placed = LABELS.layout(jobs, { grid });
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const halo = cvColor("bg", "#ffffff");
  for (const job of placed) {
    ctx.font = job.font;
    ctx.lineWidth = Math.max(2, job.size / 4);
    ctx.strokeStyle = halo;
    if (job.angle) { ctx.save(); ctx.translate(job.x, job.y); ctx.rotate(job.angle); }
    const tx = job.angle ? 0 : job.x, ty = job.angle ? 0 : job.y;
    ctx.globalAlpha = 0.85;
    ctx.strokeText(job.text, tx, ty);
    ctx.globalAlpha = 1;
    ctx.fillStyle = job.color;
    ctx.fillText(job.text, tx, ty);
    if (job.angle) ctx.restore();
  }
  ctx.restore();
  // запоминаем только на экране: на листе перетаскивания нет
  if (!_renderTarget) _labelBoxes = placed
    .filter(job => job.featureId != null)
    .map(job => ({ featureId: job.featureId, box: job.box }));
}

// Ширина текста: measureText дорогой, а на городском слое подписи повторяются
// (этажность «5» у тысяч зданий) — ключ «шрифт + строка» даёт высокий процент
// попаданий. Сам ctx.font ставится ЗДЕСЬ и только при промахе: присваивание
// шрифта само по себе дорого, а при сборке подписей его делали на каждый объект
// (20 000 присваиваний за кадр ради нескольких измерений). Перед РИСОВАНИЕМ
// шрифт всё равно ставится заново: его меняют и соседние
// рисовалки того же кадра (подпись линии, размерная линия), поэтому кешировать
// шрифт нельзя — кеш разъехался бы с фактическим состоянием холста, и подпись
// уехала бы чужим шрифтом.
const _measCache = new Map();
function measureLabel(s, font) {
  const key = font + " " + s;
  let w = _measCache.get(key);
  if (w === undefined) {
    if (_measCache.size > 4000) _measCache.clear();   // страховка от роста
    ctx.font = font;          // ставим только при промахе: присваивание шрифта дорого
    _measCache.set(key, w = ctx.measureText(s).width);
  }
  return w;
}

// Знаки ЛГР: в рабочих QML Москвы штрих (customdash_unit=MapUnit) и маркеры
// (interval_unit/size_unit=MapUnit) заданы в МЕТРАХ НА МЕСТНОСТИ, а не в мм
// листа. В библиотеке они записаны в px для опорного 1:2000, поэтому на холсте
// домножаем на зум относительно опорного — тогда плотность рисунка совпадает с
// эталоном на ЛЮБОМ масштабе, а не только на 1:2000 (прежде всё было
// фиксировано в экранных px: на 1:4451 рисунок выходил вдвое реже эталона).
// Штрих и маркер ОБЯЗАНЫ множиться на один и тот же коэффициент, иначе засечка
// уедет с черты. Нижний предел — чтобы на обзорных масштабах не слиплось.
// Пользовательских/проектных стилей не касается (у них нет ground_units).
// QML: у spritlines minScale=10000 при hasScaleBasedVisibilityFlag=1 — детальный
// знак ЛГР виден ТОЛЬКО до 1:10000, дальше QGIS показывает spritlines_uds, где
// MarkerLine нет вовсе. Поэтому за этим пределом засечки не рисуем: иначе на
// обзоре выходил «пунктир с узкими галками» (правка юзера).
const LGR_DETAIL_MAX_DENOM = 10000;
function lgrDenom() { return 3779.5 / state.view.k; }
// Масштабная видимость слоя — как «Видимость слоёв» во FlexGIS и
// scale-dependent visibility в QGIS. Выгрузка ОГД/ОСМ по городу — это десятки
// тысяч объектов, которые на обзорном масштабе не нужны и только жгут кадр.
// Порог живёт в fmt слоя (там же, где cats_off), поэтому сохраняется с проектом.
// Скрываем при ОТДАЛЕНИИ: знаменатель масштаба больше порога.
function layerInScale(L) {
  const max = L && L.fmt && L.fmt.scale_max;
  return !(max > 0) || lgrDenom() <= max;
}
// Рисуем/ловим курсором только то, что и видно, и попадает в масштаб.
// layer.visible остаётся «сырым» для панели, экспорта и «Вписать всё».
function layerDrawable(L) { return !!L && L.visible && layerInScale(L); }
// «Читаемый режим» (переключатель в «Сетка и привязки») — ТОЛЬКО для экрана.
// По эталону знак задан в метрах, поэтому на рабочих 1:4000+ засечка ~3 px:
// в QGIS так же, но чертить неудобно. В читаемом режиме коэффициент = 1, т.е.
// знак всегда выглядит как на опорном 1:2000: постоянный разборчивый размер,
// шаг заведомо крупнее засечки (37.8 px против 6.6) — вплотную не встают.
// Печать/выпуск читаемый режим НЕ трогает: Style.for_scale в scene.py про него
// не знает, лист всегда по эталону.
function lgrReadable() { return !!(state.view && state.lgrReadable); }
// Толщина линии знака в читаемом режиме. По QML она 1 px (line_width_unit=
// Pixel — единица УСТРОЙСТВА, зумом не масштабируется), это волосок. Здесь
// поднимаем до разборчивой, но НЕ переворачиваем пропорцию эталона: штрих
// засечки на опорном 1:2000 = 2.34 px, поэтому линия остаётся тоньше него.
// Только экран: печать берёт ширину из стиля как есть (Style.for_scale ширину
// не трогает — Pixel не масштабируется).
const LGR_READABLE_WIDTH_PX = 2;
const LGR_READABLE_MARKER_PX = 7;
function lgrWidth(st) {
  return (st && st.ground_units && lgrReadable())
    ? Math.max(st.width || 1, LGR_READABLE_WIDTH_PX)
    : (st ? st.width : 1);
}
function groundFactor(st) {
  if (!st || !st.ground_units) return 1;
  if (lgrReadable()) return 1;
  const refK = 3779.5 / (st.ref_scale || 2000);
  return state.view.k / refK;          // ровно по QML: без искусственного пола
}
function lgrDetailVisible(st) {
  if (!st || !st.ground_units) return true;
  if (lgrReadable()) return true;      // в читаемом знак виден на любом зуме
  return lgrDenom() <= LGR_DETAIL_MAX_DENOM;
}
function scaledDash(st) {
  const f = groundFactor(st);
  if (!st.dash || f === 1) return st.dash || null;
  const d = st.dash.map(x => x * f);
  // суб-пиксельный штрих не рисуем пунктиром: он вырождается в смаз, а
  // setLineDash с десятками тысяч сегментов на длинной линии роняет холст.
  // QML на таких масштабах знак и так прячет (minScale=10000).
  return d.reduce((a, b) => a + b, 0) < 1.5 ? null : d;
}
// Ровно по QML: и шаг (interval_unit=MapUnit), и РАЗМЕР (size_unit=MapUnit)
// засечки заданы в метрах на местности → множим оба на один коэффициент.
// Прежде размер держался постоянным на экране — из-за этого на отдалении
// галки выходили крупными относительно ужавшегося штриха и стояли вплотную
// («пунктир с узкими галками»). Теперь знак ужимается целиком, пропорционально,
// а за пределом 1:10000 не рисуется вовсе (lgrDetailVisible) — как в QGIS.
function scaledMarker(st) {
  const mk = st.line_marker;
  if (!mk) return mk;
  const f = groundFactor(st);
  if (f === 1) {
    // Читаемый режим: держим засечку разборчивой. По эталону размер маркера в
    // метрах, и на опорном 1:2000 мелкие треугольники (ПК-18, ООПТ-8, ландшафт-11)
    // — всего ~3.8 px, вырождаются в точку. Поднимаем размер до читаемого пола,
    // толщину штриха масштабируем тем же коэффициентом (сохраняя пропорцию
    // контура). ТОЛЬКО экран — печать/выпуск всегда по эталону (scaledMarker в
    // scene.py про режим не знает).
    if (st.ground_units && lgrReadable() && (mk.size || 0) < LGR_READABLE_MARKER_PX) {
      const g = LGR_READABLE_MARKER_PX / (mk.size || LGR_READABLE_MARKER_PX);
      const out = { ...mk, size: LGR_READABLE_MARKER_PX };
      if (mk.ow) out.ow = mk.ow * g;
      return out;
    }
    return mk;
  }
  // ow (толщина штриха засечки) в QML тоже MapUnit (outline_width_unit) — метры.
  // Без масштабирования глиф ужимался, а штрих оставался прежним: на 1:4451
  // засечка 3 px со штрихом 2.34 px вырождалась в кляксу. Масштабируем ВСЁ
  // одним коэффициентом; нижняя отсечка 0.4 px — чтобы штрих не исчез совсем.
  const out = { ...mk, period: (mk.period || 40) * f, size: (mk.size || 4) * f };
  if (mk.ow) out.ow = Math.max(0.4, mk.ow * f);
  return out;
}

// Засечки вдоль линии/контура. Размещение ПОСЕГМЕНТНОЕ: на каждом прямом
// ребре засечки распределяются равномерно с отступом от вершин, а не
// непрерывно по периметру — иначе на углах засечки соседних рёбер
// сходятся вплотную (в Эталоне углы свободны). mk={shape,period,size} px.
// фаза — сдвиг ряда засечек вдоль линии, в долях шага. Нужен для знаков «в обе
// стороны»: в QML это ДВА слоя MarkerLine с одинаковым interval и разным
// offset_along_line, отличающимся ровно на полшага (ООПТ 0 и 10 при шаге 20,
// ПК 4 и 14). То есть треугольники ЧЕРЕДУЮТСЯ вдоль черты, а не стоят парой в
// одной точке. Мы рисовали их в одной — выходила «бабочка» остриями наружу и
// внутрь сразу (замечание юзера: «так быть не должно»).
function drawLineMarkers(pts, mk, color, closed, inward, width, dash, фаза = 0) {
  const chain = closed ? [...pts, pts[0]] : pts;
  const scr = chain.map(p => w2s(...p));
  const period = mk.period || 40, s = mk.size || 4;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  // штрих засечки — чуть ТОНЬШЕ линии (правка юзера): галка на толщине линии
  // читалась грубовато. MARKER_WIDTH_RATIO держим единым с scene.py (печать),
  // иначе холст и PDF разойдутся.
  ctx.lineWidth = Math.max(0.4, (width || 1) * MARKER_WIDTH_RATIO);
  const dashArr = (dash && dash.length) ? dash : null;
  if (dashArr) {
    // Линия штриховая → засечка стоит ТОЛЬКО на черте, не в разрыве (правка
    // юзера). Привязываемся к центру самого длинного «штриха» в цикле dash и
    // ставим засечку на каждом k-м штрихе (k≈period/цикл, минимум 1). Фаза
    // dash отсчитывается от начала цепочки — как её рисует ctx.
    const cycle = dashArr.reduce((a, b) => a + b, 0) || period;
    let bestLen = -1, bestOff = 0, run = 0;
    for (let i = 0; i < dashArr.length; i++) {
      if (i % 2 === 0 && dashArr[i] > bestLen) { bestLen = dashArr[i]; bestOff = run + dashArr[i] / 2; }
      run += dashArr[i];
    }
    const k = Math.max(1, Math.round(period / cycle));
    let acc = 0;
    for (let i = 1; i < scr.length; i++) {
      const [x1, y1] = scr[i - 1], [x2, y2] = scr[i];
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 1e-6) continue;
      const tx = (x2 - x1) / d, ty = (y2 - y1) / d;
      const nx = -ty * inward, ny = tx * inward;
      let j = Math.ceil((acc - bestOff) / cycle);
      for (; ; j++) {
        const L = j * cycle + bestOff;      // глобальная длина центра j-го штриха
        if (L > acc + d) break;
        if (L < acc || ((j % k) + k) % k !== 0) continue;
        const t = (L - acc) / d;
        drawMarkerGlyph(mk, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t,
                        tx, ty, nx, ny, s, period);
      }
      acc += d;
    }
  } else {
    // Сплошная линия — засечки НЕПРЕРЫВНО по длине всей цепочки единым шагом
    // period (как MarkerLine в QGIS). Прежде каждое ребро делилось на метки
    // ОТДЕЛЬНО: короткие рёбра (< period/2) пропускались, а шаг d/n у каждого
    // сегмента свой — отсюда неравномерность (жалоба юзера). Теперь шаг один
    // на весь контур, вершины его не сбивают.
    let acc = 0, next = period * (0.5 + фаза);
    for (let i = 1; i < scr.length; i++) {
      const [x1, y1] = scr[i - 1], [x2, y2] = scr[i];
      const d = Math.hypot(x2 - x1, y2 - y1);
      if (d < 1e-6) continue;
      const tx = (x2 - x1) / d, ty = (y2 - y1) / d;
      const nx = -ty * inward, ny = tx * inward;
      while (next <= acc + d) {
        const t = (next - acc) / d;
        drawMarkerGlyph(mk, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t,
                        tx, ty, nx, ny, s, period);
        next += period;
      }
      acc += d;
    }
  }
  ctx.restore();
}

// Знак засечки направлен внутрь зоны: выясняем сторону по центроиду кольца
function inwardSign(ring) {
  // Сторона «внутрь» определяется ОБХОДОМ контура, а не первой его гранью.
  // Прежняя версия брала нормаль первого ребра и сравнивала со СРЕДНИМ
  // арифметическим вершин: у вытянутых и вогнутых контуров (пойма реки, ООЗТ,
  // техзона вдоль улицы) эта точка лежит вне полигона, и засечки смотрели
  // наружу. Знак площади в экранных координатах верен для любого простого
  // контура: при положительной площади нормаль (-ty, tx) смотрит внутрь —
  // ровно та, что рисует drawLineMarkers при inward = +1.
  if (!ring || ring.length < 3) return 1;
  let area2 = 0;
  let prev = w2s(ring[ring.length - 1][0], ring[ring.length - 1][1]);
  for (const point of ring) {
    const cur = w2s(point[0], point[1]);
    area2 += prev[0] * cur[1] - cur[0] * prev[1];
    prev = cur;
  }
  return area2 > 0 ? 1 : -1;
}

// Двойная параллельная линия (защитные зоны ОКН): смещение по нормалям
function drawDoubleLine(pts, gap, closed) {
  const chain = closed ? [...pts, pts[0]] : pts;
  const scr = chain.map(p => w2s(...p));
  ctx.beginPath();
  for (let i = 0; i < scr.length; i++) {
    const prev = scr[Math.max(0, i - 1)], next = scr[Math.min(scr.length - 1, i + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const d = Math.hypot(dx, dy) || 1;
    const x = scr[i][0] - dy / d * gap, y = scr[i][1] + dx / d * gap;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}

// Повторяющаяся подпись вдоль линии (условный знак ЛГР: «кл топ» и т.п.)
// Подпись линии (условный знак ЛГР: «кл топ», «водоохранная» и т.п.) —
// ОДНА на объект, на самом длинном отрезке контура/линии. Раньше подпись
// повторялась через каждые ~180px по всему периметру, что на компактных
// прямоугольниках сажало её на 3-4 стороны разом (в т.ч. вертикально на
// боковые рёбра) — нечитаемо и выглядело как баг. Один подписанный отрезок
// на самой длинной стороне — то, что реально нужно для типового объекта;
// для по-настоящему длинных линий (через весь чертёж) метки видно, пока
// видна сама протяжённая сторона.
// Повторяющаяся подпись линии/контура (красные линии, ЗОУИТ): как в эталоне
// и в QGIS-символике «line pattern», надпись повторяется вдоль линии с
// оптимальным шагом. Раньше ставилась ОДНА на самом длинном отрезке — на
// длинной красной линии терялась, на длинном контуре ЗОУИТ была одинока.
// Кегль подписи знака. В эталонном textlines.qml он задан fontSize=10 при
// fontSizeUnit=MapUnit — это 10 МЕТРОВ МЕСТНОСТИ, то есть на опорном 1:2000
// 18.9 px, и он едет вместе с зумом, как сам знак. У нас стояло глухих 10 px:
// на 1:2000 подпись выходила вдвое мельче эталона, а на 1:500 — вчетверо.
// Пользовательских стилей не касается: у них нет ground_units.
const LGR_LABEL_M = 10;
const LGR_LABEL_MIN_PX = 9;          // ниже этого не читается и печатать нечего
// В читаемом режиме у ширины линии и у засечки есть свой скромный пол
// (LGR_READABLE_WIDTH_PX, LGR_READABLE_MARKER_PX), а у подписи его не было:
// она брала эталонный кегль «10 м местности», который на опорном 1:2000 равен
// 5 мм бумаги, то есть 18.9 px — и держала его на ЛЮБОМ зуме. Рядом с линией
// в 1–2 px и интерфейсом в 11 px это выглядело огромным (замер: 18.9 px на
// всех масштабах от 1:500 до 1:5000). Читаемому режиму нужен размер
// интерфейса, а не размер бумаги.
const LGR_READABLE_LABEL_PX = 11;
function lgrLabelSizePx(st) {
  if (!st || !st.ground_units) return 10;
  if (lgrReadable()) return LGR_READABLE_LABEL_PX;
  // 3779.5 = пикселей в миллиметре × 1000 — та же величина, что в lgrDenom и
  // groundFactor этого файла; берём её же, а не MM_PX из соседнего модуля.
  const наОпорном = LGR_LABEL_M * 3779.5 / (st.ref_scale || 2000);
  return наОпорном * groundFactor(st);
}

function drawLineLabel(pts, text, color, grid, sizePx = 10) {
  const scr = pts.map(p => w2s(...p));
  if (scr.length < 2) return;
  if (sizePx < LGR_LABEL_MIN_PX) return;      // мельче — смаз, QGIS тут знак прячет
  ctx.save();
  ctx.font = `600 ${sizePx.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;
  const half = textW / 2 + 3;                  // полуширина строки + зазор
  // отрезки в экранных пикселях + суммарная длина (параметризация по дуге)
  const segs = [];
  let total = 0;
  for (let i = 1; i < scr.length; i++) {
    const [ax, ay] = scr[i - 1], [bx, by] = scr[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    segs.push({ ax, ay, bx, by, len, s0: total });
    total += len;
  }
  if (!segs.length || total < textW + 20) { ctx.restore(); return; }
  const step = Math.max(textW + 60, total / Math.max(1, Math.round(total / 320)));
  // размещаем подпись ТОЛЬКО там, где строка целиком помещается на ОДНОМ
  // прямом отрезке (не заходя за угол) — иначе текст вылезал за контур и
  // ломался на изгибах звёздчатого контура
  const places = [];
  for (let s = step / 2; s < total; s += step) {
    const seg = segs.find(sg => s >= sg.s0 && s <= sg.s0 + sg.len);
    if (!seg) continue;
    const local = s - seg.s0;
    if (local < half || local > seg.len - half) continue;
    const t = local / seg.len;
    let ang = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    places.push({ x: seg.ax + (seg.bx - seg.ax) * t, y: seg.ay + (seg.by - seg.ay) * t, ang });
  }
  if (!places.length) {                        // ни один отрезок не вместил — хотя бы одна на самом длинном
    const seg = segs.reduce((m, sg) => sg.len > m.len ? sg : m, segs[0]);
    if (seg.len >= textW + 4) {
      let ang = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      places.push({ x: (seg.ax + seg.bx) / 2, y: (seg.ay + seg.by) / 2, ang });
    }
  }
  // Подпись знака — часть условного знака, поэтому место занимает первой:
  // подписи по полю раскладываются после и обходят её. Заодно отсеиваются
  // наложения самих знаковых подписей друг на друга.
  if (grid) {
    const kept = [];
    for (const p of places) {
      // повёрнутый текст закрываем прямоугольником по его габариту
      const cos = Math.abs(Math.cos(p.ang)), sin = Math.abs(Math.sin(p.ang));
      const выс = sizePx * 1.2;   // габарит строки едет вместе с кеглем
      const bw = textW * cos + выс * sin, bh = textW * sin + выс * cos;
      const box = [p.x - bw / 2 - 2, p.y - bh / 2 - 2, p.x + bw / 2 + 2, p.y + bh / 2 + 2];
      if (grid.hits(box)) continue;
      grid.add(box);
      kept.push(p);
    }
    places.length = 0;
    places.push(...kept);
    if (!places.length) { ctx.restore(); return; }
  }
  // ДВА ПРОХОДА: сперва все гало, потом все заливки — иначе белое гало
  // следующей подписи «съедает» буквы предыдущей (пропадали части букв)
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
  for (const p of places) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.strokeText(text, 0, 0); ctx.restore(); }
  ctx.fillStyle = color;
  for (const p of places) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.fillText(text, 0, 0); ctx.restore(); }
  ctx.restore();
}

// Перерисовка схлопывается в один кадр. draw() звали синхронно из ~80 мест:
// каждое событие колеса (на тачпаде их несколько за кадр), КАЖДЫЙ загрузившийся
// тайл подложки (30-50 при старте) и наведение на строку слоя запускали полный
// проход по всем объектам. Планировщик здесь, а не в 80 местах вызова: все они
// идут через эту функцию. drawNow() остаётся для случая, когда нужен кадр
// немедленно. Ничто не читает канву синхронно после draw() (ни toDataURL, ни
// getImageData), поэтому отложить на кадр безопасно.
let _drawPending = 0;
function draw() {
  if (_drawPending) return;
  _drawPending = requestAnimationFrame(() => { _drawPending = 0; drawNow(); });
}
// Пикетаж красных линий: засечки поперёк оси и подписи ПК. Часть сцены, но
// живёт отдельно от слоёв: считается по объектам, а не по оформлению слоя.
function drawStationing() {
  // пикетаж красных линий: засечки поперёк + подписи ПК
  for (const f of state.features) {
    if (f.kind !== "redline" || !(f.props.pk_step > 0) || !f.props._stations) continue;
    if (isHidden(f)) continue;
    ctx.strokeStyle = cvColor("redline", "#d91a1a"); ctx.lineWidth = 1;
    ctx.fillStyle = cvColor("redline", "#8c1414"); ctx.font = "600 10px sans-serif"; ctx.textAlign = "center";
    for (const st of f.props._stations) {
      const [sx, sy] = w2s(st.x, st.y);
      const nx = -Math.sin(st.a), ny = Math.cos(st.a);   // нормаль к касательной
      ctx.beginPath();
      ctx.moveTo(sx - nx * 5, sy + ny * 5);
      ctx.lineTo(sx + nx * 5, sy - ny * 5);
      ctx.stroke();
      const pk = `ПК${Math.floor(st.s / 100)}+${String(Math.round(st.s % 100)).padStart(2, "0")}`;
      ctx.fillText(pk, sx + nx * 16, sy - ny * 16 + 3);
    }
  }

}

// Живые подсказки поверх сцены: направляющие привязки, пунктир склейки,
// незаконченное черчение, превью окружности, рамка выделения и измерения.
// Это не содержимое проекта, а обратная связь на текущее действие — но
// рисуются они и при выводе на лист, как было в едином drawNow. Каждый блок
// сам решает, показываться ли, по своему полю в state.
// Живые подсказки измерений: контур площади за курсором с площадью и
// периметром у последней точки, рулетка с расстоянием посередине. Вынесено
// из drawLiveHints дословно — блок ничего не берёт из её окружения.
function drawMeasureHints() {
  // измерение площади: контур за курсором, площадь и периметр у последней точки
  if (state.measureArea && state.measureArea.pts.length) {
    const m = state.measureArea;
    const chain = m.done || !state.mouse ? m.pts : [...m.pts, state.mouse];
    ctx.save();
    ctx.strokeStyle = cvColor("selection", "#2f6fde");
    ctx.fillStyle = cvColor("selection", "#2f6fde") + "22";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 3]);
    drawChain(chain, chain.length > 2);
    if (chain.length > 2) ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (chain.length > 1) {
      let per = 0;
      for (let i = 0; i + 1 < chain.length; i++)
        per += Math.hypot(chain[i + 1][0] - chain[i][0], chain[i + 1][1] - chain[i][1]);
      const closing = chain.length > 2
        ? Math.hypot(chain[0][0] - chain[chain.length - 1][0], chain[0][1] - chain[chain.length - 1][1]) : 0;
      const area = chain.length > 2 ? Math.abs(ringArea(chain)) : 0;
      const last = chain[chain.length - 1];
      const [mx, my] = w2s(last[0], last[1]);
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
      ctx.fillStyle = cvColor("selection", "#2f6fde");
      const text = area > 0
        ? `${fmtAreaHa(area)} (${Math.round(area).toLocaleString("ru-RU")} м²) · периметр ${fmtLen(per + closing)}`
        : fmtLen(per);
      ctx.fillText(text, mx + 12, my - 10);
    }
    ctx.restore();
  }
  // измерение
  if (state.measure) {
    const a = state.measure.a;
    const b = state.measure.b || state.mouse;
    if (b) {
      ctx.strokeStyle = cvColor("selection", "#2f6fde"); ctx.lineWidth = 1.2; ctx.setLineDash([6, 3]);
      drawChain([a, b], false); ctx.stroke(); ctx.setLineDash([]);
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [mx, my] = w2s((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.fillStyle = cvColor("selection", "#2f6fde"); ctx.font = "600 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(fmtLen(dist), mx, my - 6);
    }
  }
}

// Подсказки во время черчения: незамкнутый контур за курсором, живой размер
// последнего сегмента и превью окружности. Вынесено дословно — блок замкнут
// на state.drawing и не берёт ничего из окружения drawLiveHints.
function drawDrawingHints() {
  // черчение в процессе + живой размер
  if (state.drawing && Array.isArray(state.drawing.pts) && state.drawing.pts.length) {
    const st = styleForDrawing();
    ctx.strokeStyle = st.stroke || cvColor("boundary", "#000"); ctx.lineWidth = st.width || 1; ctx.setLineDash([5, 4]);
    const pts = state.mouse ? [...state.drawing.pts, state.mouse] : state.drawing.pts;
    drawChain(pts, false); ctx.stroke(); ctx.setLineDash([]);
    const base = lastDrawingPt();
    if (base && state.mouse) {
      const len = Math.hypot(state.mouse[0] - base[0], state.mouse[1] - base[1]);
      const [mx, my] = w2s(...state.mouse);
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
      if (state.typed) {
        // Показываем и набранное, и КАК понято: форм ввода пять, а молчаливое
        // «понял по-своему» — это контур, повёрнутый на 90°.
        const label = state.typed + typedInputSuffix(state.typed, base, state.mouse);
        ctx.fillStyle = cvColor("selection", "#1c1c1a");
        ctx.fillRect(mx + 10, my - 24, ctx.measureText(label).width + 12, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, mx + 16, my - 11);
      } else {
        ctx.fillStyle = cvColor("label", "#8b8a85");
        ctx.fillText(fmtLen(len), mx + 12, my - 10);
      }
    }
    // замыкание: подсветка первой точки
    const drawingPts = state.drawing.pts;
    if (TOOL_GEOM[state.tool] === "polygon" && Array.isArray(drawingPts) && drawingPts.length > 2 && state.mouse) {
      const first = drawingPts[0];
      if (Math.hypot(first[0] - state.mouse[0], first[1] - state.mouse[1]) < 12 / state.view.k) {
        const [fx, fy] = w2s(...first);
        ctx.strokeStyle = cvColor("shared", "#12a150"); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(fx, fy, 8, 0, 7); ctx.stroke();
      }
    }
    // превью дуги
    if (state.tool === "arc" && Array.isArray(drawingPts) && drawingPts.length >= 2 && state.mouse) {
      const pts = [...drawingPts, state.mouse];
      if (pts.length >= 3) {
        const a = arcFrom3Pts(pts[0], pts[1], pts[2]);
        if (a) {
          const k = state.view.k;
          const cx = state.view.tx + a.cx * k;
          const cy = state.view.ty - a.cy * k;
          ctx.beginPath();
          ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a));
          ctx.stroke();
          // visual center cross for arc
          ctx.beginPath();
          ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
          ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
          ctx.stroke();
          // больше визуалов: показываем радиус 3-point дуги
          ctx.fillStyle = cvColor("label", "#8b8a85");
          ctx.fillText(`r=${fmtLen(a.r)}`, cx + 8, cy - 8);
        }
      } else {
        drawChain(pts, false); ctx.stroke();
      }
    }
  }

  // превью окружности вне блока pts (отдельное состояние drawing для circle)
  if (state.tool === "circle" && state.drawing && state.drawing.center) {
    const st = styleForDrawing();
    ctx.strokeStyle = st.stroke || cvColor("boundary", "#000"); ctx.lineWidth = st.width || 1;
    const k = state.view.k;
    const cx = state.view.tx + state.drawing.center[0] * k;
    const cy = state.view.ty - state.drawing.center[1] * k;
    let r;
    if (state.typed) {
      const tr = parseFloat(state.typed.replace(",", "."));
      if (isFinite(tr) && tr > 0) r = tr * k;
    }
    if (!r && state.mouse) {
      r = Math.hypot(state.mouse[0] - state.drawing.center[0], state.mouse[1] - state.drawing.center[1]) * k;
    }
    if (r && r > 2) {
      ctx.save();
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
      const [mx, my] = state.mouse ? w2s(...state.mouse) : [cx + r, cy];
      ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
      ctx.fillStyle = state.typed ? cvColor("selection", "#1c1c1a") : cvColor("label", "#8b8a85");
      const txt = (state.typed || (r/k).toFixed(1)) + " м";
      if (state.typed) {
        ctx.fillRect(mx + 10, my - 24, ctx.measureText(txt).width + 12, 18);
        ctx.fillStyle = "#fff";
      }
      ctx.fillText(txt, mx + 16, my - 11);
    }
  }

  if (state.drag && state.drag.rect) {
    const { a, b } = state.drag;
    const [sx1, sy1] = w2s(...a), [sx2, sy2] = w2s(...b);
    const bst = styleForDrawing();
    ctx.strokeStyle = bst.stroke || cvColor("label", "#888");
    ctx.fillStyle = (bst.fill || cvColor("zoneB", "#cccccc")) + (bst.fill ? "88" : "");
    ctx.fillRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
    ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
    ctx.fillStyle = cvColor("label", "#5c5a54"); ctx.font = "600 12px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(`${fmtCoord(Math.abs(b[0] - a[0]))} × ${fmtCoord(Math.abs(b[1] - a[1]))} м`,
                 Math.max(sx1, sx2) + 8, Math.min(sy1, sy2) - 6);
  }
}

function drawLiveHints() {
  // направляющие выравнивания
  if (state.guides.length) {
    ctx.strokeStyle = cvColor("shared", "#12a150"); ctx.lineWidth = 0.8; ctx.setLineDash([4, 4]);
    for (const [a, b] of state.guides) { drawChain([a, b], false); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // наглядность для склейки: пунктир между близкими концами выбранных
  if (!state.trimCtx && state.selectedIds.size > 1) {
    const sels = selectionFeatures().filter(f => f.line || f.arc);
    if (sels.length > 1) {
      const tol = 15 / state.view.k;
      ctx.strokeStyle = cvColor("accent", "#2f6fde");
      ctx.lineWidth = 1;
      ctx.setLineDash([3,2]);
      for (let i=0; i<sels.length; i++) {
        for (let j=i+1; j<sels.length; j++) {
          const c1 = sels[i].line || (sels[i].arc ? featurePts(sels[i]) : null);
          const c2 = sels[j].line || (sels[j].arc ? featurePts(sels[j]) : null);
          if (!c1 || !c2 || c1.length<2 || c2.length<2) continue;
          const ends1 = [c1[0], c1[c1.length-1]];
          const ends2 = [c2[0], c2[c2.length-1]];
          for (let e1 of ends1) for (let e2 of ends2) {
            if (Math.hypot(e1[0]-e2[0], e1[1]-e2[1]) < tol) {
              ctx.beginPath();
              ctx.moveTo(...w2s(...e1));
              ctx.lineTo(...w2s(...e2));
              ctx.stroke();
            }
          }
        }
      }
      ctx.setLineDash([]);
    }
  }

  drawDrawingHints();
  // рамка выделения (мультивыбор инструментом «Выбор»)
  if (state.drag && state.drag.marquee) {
    const { a, b } = state.drag;
    const [sx1, sy1] = w2s(...a), [sx2, sy2] = w2s(...b);
    const x = Math.min(sx1, sx2), y = Math.min(sy1, sy2);
    const w = Math.abs(sx2 - sx1), h = Math.abs(sy2 - sy1);
    ctx.save();
    ctx.strokeStyle = cvColor("selection", "#2f6fde");
    ctx.fillStyle = cvColor("selection", "#2f6fde") + "18";
    ctx.lineWidth = 1; ctx.setLineDash([5, 3]);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  drawMeasureHints();
  xfDrawOverlay(ctx);
}

// Порог уровня детализации в экранных пикселях: объект мельче этого показать
// подробнее, чем пятном, физически невозможно.
const LOD_PX = 2.5;
// Уровень детализации: мелкий контур рисуется одним прямоугольником.
//
// На городском масштабе здание занимает пиксель-два: полный контур с обводкой
// и штриховкой стоит столько же, сколько крупный квартал, а показывает пятно.
// Замер на 100 000 зданий: растеризация — три четверти кадра (1306 мс из
// 1710), из них заливка ~950. Упрощение дало 1504 → 252 мс на кадр, и картинка
// при этом неотличима: средний цвет сдвинулся на единицу из 255, закрашенных
// пикселей столько же.
//
// Возвращает true, если объект отрисован упрощённо. Условия — про
// правильность, а не про скорость, и каждое стережёт tests/lod-heavy-layers:
//   - на ЛИСТЕ (_renderTarget) никогда: выпуск обязан уходить полным, иначе
//     чертёж уйдёт заказчику без деталей и никто этого не заметит;
//   - выделенное никогда: человек рассматривает именно его;
//   - только замкнутый контур с заливкой: у линии вся суть в обводке;
//   - порог по ОБЕИМ сторонам: узкая, но длинная зона рисуется полностью.
// Выноска: остриё у объекта, наклонный отрезок, горизонтальная полка и
// надпись над ней. Отдельного примитива под текст в модели нет — выноска это
// ЛИНИЯ из двух точек на служебном слое, а надпись лежит в props.text. Так она
// сама попадает в отмену, сохранение и обмен, ничего не зная про отрисовку.
function drawLeader(f, st) {
  const [a, b] = [f.line[0], f.line[f.line.length - 1]];
  const [ax, ay] = w2s(a[0], a[1]);
  const [bx, by] = w2s(b[0], b[1]);
  const текст = (f.props && f.props.text) || "";
  ctx.save();
  ctx.strokeStyle = st.stroke || cvColor("boundary", "#44423c");
  ctx.lineWidth = st.width || 0.8;
  ctx.setLineDash([]);
  // полка идёт в ту же сторону, куда уходит выноска: влево от острия — влево
  const вправо = bx >= ax;
  ctx.font = "600 11px sans-serif";
  const ширина = Math.max(12, ctx.measureText(текст).width);
  const конецПолки = bx + (вправо ? ширина : -ширина);
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(конецПолки, by);
  ctx.stroke();
  // остриё: залитая стрелка вдоль отрезка
  const угол = Math.atan2(by - ay, bx - ax);
  const д = 7;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + д * Math.cos(угол - 0.28), ay + д * Math.sin(угол - 0.28));
  ctx.lineTo(ax + д * Math.cos(угол + 0.28), ay + д * Math.sin(угол + 0.28));
  ctx.closePath();
  ctx.fillStyle = st.stroke || cvColor("boundary", "#44423c");
  ctx.fill();
  if (текст) {
    ctx.textAlign = вправо ? "left" : "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(текст, bx + (вправо ? 3 : -3), by - 4);
  }
  ctx.restore();
}

function drawTinyRing(f, st) {
  if (_renderTarget || !f.ring || !st.fill || st.fill === "transparent") return false;
  if (state.selectedIds.has(f.id)) return false;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of f.ring) {
    if (p[0] < bx0) bx0 = p[0];
    if (p[0] > bx1) bx1 = p[0];
    if (p[1] < by0) by0 = p[1];
    if (p[1] > by1) by1 = p[1];
  }
  const sw = (bx1 - bx0) * state.view.k, sh = (by1 - by0) * state.view.k;
  if (!(sw < LOD_PX && sh < LOD_PX)) return false;
  const [sx0, sy0] = w2s(bx0, by1);            // верхний левый угол на экране
  ctx.fillStyle = st.fill;
  if (st.fillOpacity != null) ctx.globalAlpha = st.fillOpacity;
  ctx.fillRect(sx0, sy0, Math.max(1, sw), Math.max(1, sh));
  if (st.fillOpacity != null) ctx.globalAlpha = 1;
  return true;
}

// Отрисовка ОДНОГО объекта в его слое: знак, штрих в метрах местности, ветки
// по виду (выноска, размер, пикетаж…) и заявка на подпись. Вынесено из drawNow
// дословно — 246 строк тела внутреннего цикла. Снаружи нужны только объект,
// его слой и две копилки кадра: заявки на подписи и сетка занятости.
// Ветки по геометрии: размерная линия с засечками, точка, дуга, окружность,
// линии и полигоны с заливкой и штриховкой. Штрих и толщина приходят готовыми —
// они считаются один раз на объект и обязаны совпасть с засечками маркеров.
// Засечки знака по контуру объекта.
//
// Направление по эталону: остриём ВНУТРЬ зоны по умолчанию, dir "out" — наружу
// (ландшафт ОКН), dir "both" — двумя рядами (8 ООПТ, 18 ПК, 55 памятник).
// Сторона из ДАННЫХ важнее знака: у объектов ОГД она задана знаком LineCode
// («1» и «−1» — одна линия, зона с разных сторон), и это точнее нашей догадки
// по центроиду. inwardSign остаётся для объектов без LineCode.
function drawFeatureMarkers(f, st, stWidth, stDash) {
  const side0 = f.props && f.props.line_side;
  const mkColor = st.stroke || cvColor("redline", "#df0024");
  const mkScaled = scaledMarker(st), mkDir = st.line_marker.dir;
  const ringMarkers = (ring, baseInw, closed) => {
    // «в обе стороны» = ЧЕРЕДОВАНИЕ вдоль линии: второй ряд сдвинут на полшага,
    // как два MarkerLine эталона. Иначе оба треугольника встают в одной точке и
    // знак читается как «бабочка» — остриями наружу и внутрь сразу.
    const ряды = mkDir === "both" ? [[baseInw, 0], [-baseInw, 0.5]]
               : (!side0 && mkDir === "out") ? [[-baseInw, 0]] : [[baseInw, 0]];
    for (const [side, фаза] of ряды)
      drawLineMarkers(ring, mkScaled, mkColor, closed, side, stWidth, stDash, фаза);
  };
  if (f.ring) {
    ringMarkers(f.ring, side0 || (f.ring.length > 2 ? inwardSign(f.ring) : 1), true);
    // Дыры выколотого полигона: засечки смотрят В ПОЛИГОН = ИЗ дыры (инверсия
    // относительно внешней границы) — метки окантовывают материал, а не пустоту.
    for (const hole of f.holes || [])
      if (hole.length > 2) ringMarkers(hole, -inwardSign(hole), true);
  } else if (f.line) {
    ringMarkers(f.line, side0 || 1, false);
  }
}

function drawFeatureGeometry(f, layer, st, stDash, stWidth, _labelGrid) {
      if (layer.kind === "leader" && f.line) { drawLeader(f, st); } else if (layer.kind === "dim" && f.line) {
        // размерная линия: засечки 45° на концах + длина вдоль линии
        const [ax, ay] = w2s(...f.line[0]);
        const [bx, by] = w2s(...f.line[f.line.length - 1]);
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        for (const [px, py] of [[ax, ay], [bx, by]]) {
          ctx.moveTo(px - 5 * Math.cos(ang + Math.PI / 4), py - 5 * Math.sin(ang + Math.PI / 4));
          ctx.lineTo(px + 5 * Math.cos(ang + Math.PI / 4), py + 5 * Math.sin(ang + Math.PI / 4));
        }
        ctx.stroke();
        const lenM = Math.hypot(f.line[1][0] - f.line[0][0], f.line[1][1] - f.line[0][1]);
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        let ta = ang;
        if (ta > Math.PI / 2 || ta < -Math.PI / 2) ta += Math.PI;  // текст не вверх ногами
        ctx.rotate(ta);
        ctx.fillStyle = st.stroke; ctx.font = "600 11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(fmtLen(lenM), 0, -5);
        ctx.restore();
        ctx.setLineDash([]);
      } else if (f.point) {
        const [sx, sy] = w2s(...f.point);
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fillStyle = st.fill; ctx.fill(); ctx.stroke();
        // радиус доступности соцобъекта (визуальная помощь, вкл/выкл + настройка
        // радиуса в «Сетка и привязки»); радиус на объекте (props.access_r)
        // перекрывает общий — у разных служб он разный (ДОО/школа/поликлиника)
        if (f.kind === "social" && state.accessRadii && state.accessRadii.on) {
          const rMeters = f.props && f.props.access_r > 0 ? f.props.access_r : (state.accessRadii.r || 300);
          const rr = rMeters * state.view.k;
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = cvColor("accent", "#2f6fde");
          ctx.globalAlpha = 0.22;
          ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.stroke();
          ctx.globalAlpha = 0.5; ctx.setLineDash([]);
          ctx.font = "10px sans-serif"; ctx.textAlign = "center";
          ctx.fillStyle = cvColor("accent", "#2f6fde");
          ctx.fillText(`R ${rMeters} м`, sx, sy - rr - 3);
          ctx.restore();
        }
      } else if (f.arc) {
        const a = f.arc;
        const k = state.view.k;
        const cx = state.view.tx + a.cx * k;
        const cy = state.view.ty - a.cy * k;
        const r = a.r * k;
        ctx.beginPath();
        ctx.arc(cx, cy, r, ...arcScreenArgs(a));
        ctx.stroke();
      } else if (f.circle) {
        const c = f.circle;
        const k = state.view.k;
        const cx = state.view.tx + c.cx * k;
        const cy = state.view.ty - c.cy * k;
        ctx.beginPath();
        ctx.arc(cx, cy, c.r * k, 0, 2 * Math.PI);
        ctx.stroke();
      } else {
        if ((f.props.radius || 0) > 0 && f.line && f.line.length > 2) {
          ctx.beginPath();
          ctx.moveTo(...w2s(...f.line[0]));
          for (let i = 1; i < f.line.length - 1; i++)
            ctx.arcTo(...w2s(...f.line[i]), ...w2s(...f.line[i + 1]),
                      f.props.radius * state.view.k);
          ctx.lineTo(...w2s(...f.line[f.line.length - 1]));
        } else {
          drawChain(f.ring || f.line, !!f.ring);
        }
        // дыры — подпути в том же пути (см. addHoleSubpaths)
        const hasHoles = f.ring ? addHoleSubpaths(f.holes) : false;
        if (st.fill && f.ring) {
          ctx.save();
          if (st.fillOpacity != null) ctx.globalAlpha = st.fillOpacity;
          ctx.fillStyle = st.fill;
          ctx.fill(hasHoles ? "evenodd" : "nonzero");
          ctx.restore();
        }
        ctx.stroke();
        if (st.hatch && f.ring) drawHatch(f.ring, st.hatch, st.stroke, f.holes);
        if (st.dots && f.ring) drawDots(f.ring, st.dots, f.holes);
        if (st.double) drawDoubleLine(f.ring || f.line, st.double, !!f.ring);
        if (st.line_marker && (f.ring || f.line) && lgrDetailVisible(st))
          drawFeatureMarkers(f, st, stWidth, stDash);
        if (st.line_label) {
          const pts = f.ring ? [...f.ring, f.ring[0]] : f.line;
          drawLineLabel(pts, st.line_label, st.stroke || cvColor("redline", "#d91a1a"), _labelGrid, lgrLabelSizePx(st));
        }
      }
      ctx.setLineDash([]);
}

// Подсветки состояний поверх самого объекта: выделение, границы обрезки, цель
// обрезки, наведение «Определить», принадлежность активному слою и вершины
// одиночного выделения. Все читают state и объект — больше ничего.
function drawFeatureHighlights(f, layer) {
      if (state.selectedIds.has(f.id)) {
        ctx.strokeStyle = cvColor("selection", "#2f6fde");
        ctx.lineWidth = state.trimCtx ? 2.8 : 1.5;
        ctx.setLineDash([4, 3]);
        if (f.point) { const [sx, sy] = w2s(...f.point); ctx.strokeRect(sx - 9, sy - 9, 18, 18); }
        else if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        }
        else if (f.arc) {
          const a = f.arc;
          const k = state.view.k;
          const cx = state.view.tx + a.cx * k;
          const cy = state.view.ty - a.cy * k;
          ctx.beginPath();
          ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a));
          ctx.stroke();
        } else { drawChain(f.ring || f.line, !!f.ring); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // граница для обрезки/продления — выбрана в 1-м шаге инструмента
      if (state.trimCtx && state.trimCtx.boundary.has(f.id)) {
        // сильный визуал: halo + толстая пунктирная
        ctx.save();
        ctx.strokeStyle = "rgba(224, 138, 30, 0.3)";
        ctx.lineWidth = 7;
        ctx.setLineDash([]);
        if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        } else {
          const ch = f.ring || f.line || (f.arc ? featurePts(f) : null);
          if (ch) { drawChain(ch, !!f.ring); ctx.stroke(); }
        }
        ctx.restore();
        ctx.strokeStyle = cvColor("warning", "#e08a1e"); ctx.lineWidth = 4; ctx.setLineDash([2, 3]);
        if (f.circle) {
          const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke();
        } else {
          const ch = f.ring || f.line || (f.arc ? featurePts(f) : null);
          if (ch) { drawChain(ch, !!f.ring); ctx.stroke(); }
        }
        ctx.setLineDash([]);
      }
      // когда готов к обрезке, подсвечиваем возможные цели (не границы)
      if (state.trimCtx && state.trimCtx.ready && !state.trimCtx.boundary.has(f.id) && (f.line || f.arc)) {
        ctx.save();
        ctx.strokeStyle = cvColor("accent", "#3b63f6"); ctx.lineWidth = 2.0; ctx.setLineDash([2, 2]);
        if (f.line) {
          drawChain(f.line, false); ctx.stroke();
        } else if (f.arc) {
          const a = f.arc; const k = state.view.k;
          const cx = state.view.tx + a.cx * k; const cy = state.view.ty - a.cy * k;
          ctx.beginPath(); ctx.arc(cx, cy, a.r * k, ...arcScreenArgs(a)); ctx.stroke();
        }
        ctx.restore();
      }
      // наведение на строку списка «что под курсором» — подсветка этого объекта
      if (state.hoverIdentifyId === f.id) {
        ctx.save();
        ctx.strokeStyle = cvColor("selection", "#2f6fde"); ctx.lineWidth = 3;
        ctx.setLineDash([]); ctx.lineJoin = "round";
        if (f.point) { const [sx, sy] = w2s(...f.point); ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 2 * Math.PI); ctx.stroke(); }
        else if (f.circle) { const [sx, sy] = w2s(f.circle.cx, f.circle.cy);
          ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2 * Math.PI); ctx.stroke(); }
        else { const chain = f.ring || f.line || featurePts(f); if (chain) { drawChain(chain, !!f.ring); ctx.stroke(); } }
        ctx.restore();
      }
      // ховер строки слоя в панели — мягкая подсветка его объектов на холсте
      if (state.hoverLayerId === layer.id) {
        ctx.save();
        ctx.strokeStyle = cvColor("accent", "#2f6fde"); ctx.lineWidth = 4;
        ctx.globalAlpha = 0.35; ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (f.point) { const [sx, sy] = w2s(...f.point); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.stroke(); }
        else if (f.circle) { const [sx, sy] = w2s(f.circle.cx, f.circle.cy); ctx.beginPath(); ctx.arc(sx, sy, f.circle.r * state.view.k, 0, 2*Math.PI); ctx.stroke(); }
        else { drawChain(f.ring || f.line, !!f.ring); ctx.stroke(); }
        ctx.restore();
      }
      // ручки вершин — только у первичного (одиночного) выбора
      if (f.id === state.selected) {
        const shared = sharedVertexSet(f);
        const shFill = cvColor("shared", "#12a150"), vxStroke = cvColor("vertex", "#2f6fde");
        const handleBg = cvColor("bg", "#fff");
        // ручки по ВСЕМ кольцам (внешний контур + дыры): у выколотого полигона
        // вершины дыр теперь тоже выделяются и редактируются. shared (общая
        // граница coverage-зон) — только у внешнего кольца (ri===0).
        const rings = featureRings(f);
        if (rings.length) {
          rings.forEach((ring, ri) => {
            ring.forEach((p, li) => {
              const [sx, sy] = w2s(...p);
              const isShared = ri === 0 && shared.has(li);
              ctx.fillStyle = isShared ? shFill : handleBg;
              ctx.strokeStyle = isShared ? shFill : vxStroke;
              ctx.lineWidth = 1.2;
              ctx.fillRect(sx - 3, sy - 3, 6, 6); ctx.strokeRect(sx - 3, sy - 3, 6, 6);
            });
          });
        } else {
          featurePts(f).forEach((p, i) => {   // дуга/окружность — как было
            const [sx, sy] = w2s(...p);
            const isShared = shared.has(i);
            ctx.fillStyle = isShared ? shFill : handleBg;
            ctx.strokeStyle = isShared ? shFill : vxStroke;
            ctx.lineWidth = 1.2;
            ctx.fillRect(sx - 3, sy - 3, 6, 6); ctx.strokeRect(sx - 3, sy - 3, 6, 6);
          });
        }
      }
}

function drawFeatureOnLayer(f, layer, _labelJobs, _labelGrid) {
      const st = styleOf(f);
      // ЛГР: штрих в метрах местности → px по текущему зуму (см. groundFactor).
      // Этот же массив уходит в drawLineMarkers — фаза засечки обязана
      // считаться по ТОМУ ЖЕ штриху, которым рисуется линия.
      const stDash = scaledDash(st);
      ctx.setLineDash(stDash || []);
      // читаемый режим поднимает волосок 1 px до разборчивого (см. lgrWidth)
      const stWidth = lgrWidth(st);
      ctx.lineWidth = stWidth; ctx.strokeStyle = canvasStrokeOf(f, st);
      if (drawTinyRing(f, st)) return;   // пропуск объекта: в цикле это был continue
      drawFeatureGeometry(f, layer, st, stDash, stWidth, _labelGrid);
      if (st.label_field) {
        const v = labelOf(f);
        if (v !== undefined && v !== "" && v !== null) {
          const job = labelJob(f, st, String(v), layer);
          if (job) { job.featureId = f.id; _labelJobs.push(applyLabelOffset(job, f)); }
        }
      }
      drawFeatureHighlights(f, layer);
}

function drawNow() {
  const w = viewportW(), h = viewportH();
  ctx.clearRect(0, 0, w, h);
  // На листе ни сетки, ни тайлов подложки: сетка — вспомогательная разметка
  // экрана, а растр вкладывается отдельно, когда до него дойдёт очередь.
  if (!_renderTarget) { drawBasemap(w, h); drawGrid(w, h); }

  // видимый мировой прямоугольник (+ поле) для отсечения объектов за экраном
  const _vpad = 40 / state.view.k;
  const _p0 = s2w(0, h), _p1 = s2w(w, 0);
  const vMinX = Math.min(_p0[0], _p1[0]) - _vpad, vMaxX = Math.max(_p0[0], _p1[0]) + _vpad;
  const vMinY = Math.min(_p0[1], _p1[1]) - _vpad, vMaxY = Math.max(_p0[1], _p1[1]) + _vpad;
  const _cull = f => {
    if (f.point) return f.point[0] < vMinX || f.point[0] > vMaxX || f.point[1] < vMinY || f.point[1] > vMaxY;
    if (f.circle) { const c = f.circle; return c.cx + c.r < vMinX || c.cx - c.r > vMaxX || c.cy + c.r < vMinY || c.cy - c.r > vMaxY; }
    if (f.arc) { const a = f.arc; return a.cx + a.r < vMinX || a.cx - a.r > vMaxX || a.cy + a.r < vMinY || a.cy - a.r > vMaxY; }
    const pts = f.ring || f.line; if (!pts || !pts.length) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return x1 < vMinX || x0 > vMaxX || y1 < vMinY || y0 > vMaxY;
  };
  // бакет объектов по слою ОДИН раз (было O(слои×объекты): каждый объект
  // перебирался заново на каждый слой) + отсечение по видимой области.
  const _byLayer = new Map();
  for (const f of state.features) {
    const L = layerOf(f);
    if (!layerDrawable(L) || _cull(f) || catOff(L, f)) continue;
    let arr = _byLayer.get(L); if (!arr) _byLayer.set(L, arr = []); arr.push(f);
  }
  // Подписи собираются за кадр и раскладываются ПОСЛЕ отрисовки объектов
  // (см. app-labels.js). Сетка занятости одна на кадр, а не на слой: раньше
  // подписи разных слоёв садились друг на друга, потому что сеток было столько
  // же, сколько слоёв. Подписи знака (вдоль линии) рисуются сразу — они часть
  // условного знака — и занимают места первыми.
  const _labelGrid = LABELS ? LABELS.createGrid() : null;
  const _labelJobs = [];
  for (const layer of LAYERS_V2) {
    if (!layer.visible) continue;
    const _feats = _byLayer.get(layer); if (!_feats) continue;
    for (const f of _feats) drawFeatureOnLayer(f, layer, _labelJobs, _labelGrid);
  }

  // подписи объектов: раскладка по одной сетке на кадр, важность решает, кто
  // займёт спорное место
  drawLabelJobs(_labelJobs, _labelGrid);

  // рамка листа — только на экране: на самом листе её быть не должно
  if (!_renderTarget && typeof sheetDrawOverlay === "function") sheetDrawOverlay(ctx);

  drawStationing();
  drawLiveHints();

  // находки проверки топологии поверх всего: app-topo.js грузится позже app.js,
  // поэтому обращение защищено (как и в node-тестах, где модуля нет вовсе)
  if (typeof topoDrawOverlay === "function") topoDrawOverlay(ctx);
  if (typeof simplifyDrawOverlay === "function") simplifyDrawOverlay(ctx);
  arrayDrawOverlay(ctx);
  drawSnapMarker();
  updateOverlay();
}

// масштабная линейка + компас + онбординг поверх холста
function niceRound(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}
function updateOverlay() {
  const bar = document.getElementById("cv-scale-bar");
  const lab = document.getElementById("cv-scale-label");
  if (!bar || !lab) return;
  const mpp = 1 / state.view.k;              // метров мира на экранный пиксель
  const bm = niceRound(90 * mpp);            // «круглая» длина ~90 px
  bar.style.width = Math.round(bm * state.view.k) + "px";
  const dist = bm >= 1000 ? (bm / 1000) + " км" : bm + " м";
  // ~1:N — приблизительно (экранный пиксель ≈ 1/96 дюйма), потому с тильдой
  const denom = Math.round(mpp * 3779.5);
  lab.textContent = `${dist} · ~1:${denom.toLocaleString("ru-RU")}`;
}

