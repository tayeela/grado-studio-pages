// ГРАДО Студия · часть 5 из 14 (грузится после app-geom.js).
// отрисовка сцены
//
// Файлы app*.js — обычные скрипты с общей глобальной областью, поэтому
// ПОРЯДОК ЗАГРУЗКИ В index.html ЗНАЧИМ и совпадает с порядком строк
// прежнего единого app.js. Тесты читают части через tests/app-source.js.
// ---------- отрисовка ----------
// Спред здесь стоил дороже, чем кажется: `ctx.moveTo(...w2s(...pt))` на КАЖДУЮ
// вершину разворачивает два массива. Замер на 30 000 зданий: 446 мс со
// спредом против 26 мс без него. Числа те же и w2s зовётся так же — меняется
// только то, как координаты доезжают до холста.
// Прореживание контура под текущий зум (LOD).
//
// Замер показал, за что платит кадр: не за число объектов, а за число ВЕРШИН.
// 200 000 четырёхугольников и 50 000 сорокаугольников рисуются одинаково —
// 344 и 365 мс, — потому что вершин в обоих случаях около двух миллионов.
// Отсечение невидимого тут не помогает: на полном охвате видно всё.
// А выгрузки ОСМ и портала несут тысячи вершин на прямых участках, и на
// мелком масштабе большинство из них ложится в один и тот же пиксель.
//
// Поэтому перед отрисовкой контур прореживается тем же Дугласом-Пекером,
// что и в окне «Упростить» — но с допуском в ДОЛЮ ПИКСЕЛЯ экрана, то есть
// на глаз разницы нет по построению. Данные при этом не трогаются: результат
// живёт в кэше при самом массиве и пересчитывается только при смене ступени.
//
// Ступень — степень двойки: иначе кэш сбрасывался бы на каждое движение
// колеса. Кэш неперечислимый: сохранение проекта, снимок истории и выгрузка
// обходят объект через JSON, и лишнее поле уехало бы в файл.
const LOD_ПИКСЕЛЬ = 0.6;          // допуск в пикселях экрана
const LOD_ОТ_ВЕРШИН = 24;         // короткий контур прореживать нечего
function lodChain(chain, close) {
  if (!chain || chain.length < LOD_ОТ_ВЕРШИН) return chain;
  // Выпуск листа и PDF идут по тем же функциям, но там пиксель — единица
  // бумаги, и терять вершины в выпуске нельзя: чертёж уходит заказчику.
  if (_renderTarget) return chain;
  const упростить = window.GRADO_EDIT && window.GRADO_EDIT.simplifyChain;
  if (!упростить) return chain;
  const допуск = LOD_ПИКСЕЛЬ / state.view.k;
  if (!(допуск > 0)) return chain;
  const ступень = Math.pow(2, Math.ceil(Math.log2(допуск)));
  let кэш = chain.__lod;
  if (!кэш) {
    кэш = { ступень: null, close: null, out: null };
    Object.defineProperty(chain, "__lod", { value: кэш, enumerable: false, writable: true });
  }
  if (кэш.ступень !== ступень || кэш.close !== close) {
    кэш.ступень = ступень; кэш.close = close;
    const out = упростить(chain, ступень, close);
    // Контур схлопнулся в отрезок — на этом зуме он мельче пикселя, но
    // рисовать пустоту нельзя: отдаём исходный, его нарисует drawTinyRing.
    кэш.out = out.length >= (close ? 3 : 2) ? out : chain;
  }
  return кэш.out;
}

function drawChain(chain, close) {
  chain = lodChain(chain, close);
  if (!chain || !chain.length || !chain[0]) return;
  ctx.beginPath();
  let p = w2s(chain[0][0], chain[0][1]);
  ctx.moveTo(p[0], p[1]);
  for (let i = 1; i < chain.length; i++) {
    p = w2s(chain[i][0], chain[i][1]);
    ctx.lineTo(p[0], p[1]);
  }
  if (close) ctx.closePath();
}

// Дыры полигона (выколотые полигоны ОГД). Внутренние кольца добавляются
// ПОДПУТЯМИ в уже начатый путь (beginPath сделал drawChain) — заливка по
// "evenodd" тогда оставляет дыру дырой независимо от направления обхода
// кольца (в данных портала оно не гарантировано, на nonzero дыра пропала бы).
// Обводка идёт по всем кольцам — контур дыры виден, как и должен.
function addHoleSubpaths(holes) {
  if (!holes || !holes.length) return false;
  let added = false;
  for (const hole of holes) {
    // дыры прореживаются тем же LOD, что и внешний контур: иначе на мелком
    // масштабе внешнее кольцо уже упрощено, а дыра нет — и они разъезжаются
    const h = lodChain(hole, true);
    if (!h || h.length < 3) continue;
    let p = w2s(h[0][0], h[0][1]);
    ctx.moveTo(p[0], p[1]);
    for (let i = 1; i < h.length; i++) { p = w2s(h[i][0], h[i][1]); ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
    added = true;
  }
  return added;
}

function drawGrid(w, h) {
  if (!state.gridShow) return;
  const g = gridStep();
  const [wx0, wy1] = s2w(0, 0), [wx1, wy0] = s2w(w, h);
  const px = g * state.view.k;
  // крупные линии каждые 5 шагов
  ctx.lineWidth = 1;
  const gridAxis = cvColor("label", "#d5d2ca"), gridLine = cvColor("grid", "#eceae5");
  // ось нулевых координат приглушаем: на пустом холсте жирная одинокая
  // черта цветом подписей выглядела случайным артефактом вёрстки
  for (let x = Math.floor(wx0 / (g * 5)) * g * 5; x <= wx1; x += g * 5) {
    ctx.strokeStyle = x === 0 ? gridAxis : gridLine;
    ctx.globalAlpha = x === 0 ? 0.45 : 1;
    ctx.beginPath(); ctx.moveTo(...w2s(x, wy0)); ctx.lineTo(...w2s(x, wy1)); ctx.stroke();
  }
  for (let y = Math.floor(wy0 / (g * 5)) * g * 5; y <= wy1; y += g * 5) {
    ctx.strokeStyle = y === 0 ? gridAxis : gridLine;
    ctx.globalAlpha = y === 0 ? 0.45 : 1;
    ctx.beginPath(); ctx.moveTo(...w2s(wx0, y)); ctx.lineTo(...w2s(wx1, y)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // точки в узлах мелкого шага (как в Rayon)
  if (px >= 11) {
    ctx.fillStyle = cvColor("grid", "#c9c6bd");
    for (let x = Math.floor(wx0 / g) * g; x <= wx1; x += g)
      for (let y = Math.floor(wy0 / g) * g; y <= wy1; y += g) {
        const [sx, sy] = w2s(x, y);
        ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
      }
  }
  document.getElementById("st-grid").textContent =
    `сетка ${g} м${state.gridSnap ? "" : " (без привязки)"}`;
}


// Штриховка зоны по Эталону ЛГР: hatch = true (легаси 45° цветом обводки)
// или {angle: 0|45|90|135, cross, spacing_px, color}. Рисуется в клипе контура.
function drawHatch(ring, hatch, strokeColor, holes) {
  const spec = hatch === true
    ? { angle: 45, spacing_px: 9, color: strokeColor }
    : hatch;
  ctx.save();
  drawChain(ring, true);
  // дыры исключаются и из штриховки: клип по even-odd (иначе штрих зашёл бы
  // внутрь выколотой части и дыра читалась бы как обычная зона)
  const hasHoles = addHoleSubpaths(holes);
  ctx.clip(hasHoles ? "evenodd" : "nonzero");
  const ss = ring.map(p => w2s(...p));
  // экранный bbox кольца ОДНИМ проходом (без Math.min(...spread) — медленно/краш
  // на больших кольцах), ЗАЖАТЫЙ по видимому холсту: штрих-линии за экраном
  // невидимы под clip, а без зажима крупный полигон при зуме давал миллионы
  // итераций цикла ниже → полный фриз интерфейса на большом проекте.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ss) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const _m = (spec.spacing_px || 9) * 2;
  x0 = Math.max(x0, -_m); x1 = Math.min(x1, viewportW() + _m);
  y0 = Math.max(y0, -_m); y1 = Math.min(y1, viewportH() + _m);
  if (x1 <= x0 || y1 <= y0) { ctx.restore(); return; }
  ctx.strokeStyle = spec.color || strokeColor;
  ctx.lineWidth = 1.0;
  ctx.setLineDash([]);
  const step = Math.max(3, spec.spacing_px || 9);
  const angles = spec.cross ? [45, 135] : [spec.angle ?? 45];
  for (const a of angles) {
    ctx.beginPath();
    if (a === 0) {                       // горизонтальные
      for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    } else if (a === 90) {               // вертикальные
      for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    } else if (a === 45) {               // «///» (вверх слева направо на экране)
      const d = step * Math.SQRT2;
      for (let c = x0 - (y1 - y0); c < x1; c += d) {
        ctx.moveTo(c, y1); ctx.lineTo(c + (y1 - y0), y0);
      }
    } else {                             // 135°: «\\\»
      const d = step * Math.SQRT2;
      for (let c = x0 - (y1 - y0); c < x1; c += d) {
        ctx.moveTo(c + (y1 - y0), y1); ctx.lineTo(c, y0);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Точечный узор ПОВЕРХ заливки (PointPatternFill эталона): сетка кружков внутри
// полигона. Зоны «в составе ООПТ» отличаются от базовых именно точками. Клип по
// even-odd (дыры исключены), шаг/размер — экранные px (как штриховка), стабильны
// при зуме — texture, а не геометрия местности.
function drawDots(ring, dots, holes) {
  ctx.save();
  drawChain(ring, true);
  const hasHoles = addHoleSubpaths(holes);
  ctx.clip(hasHoles ? "evenodd" : "nonzero");
  const ss = ring.map(p => w2s(...p));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ss) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const step = Math.max(4, dots.spacing_px || 8);
  const r = Math.max(0.6, (dots.size_px || 2) / 2);
  x0 = Math.max(x0, -step); x1 = Math.min(x1, viewportW() + step);
  y0 = Math.max(y0, -step); y1 = Math.min(y1, viewportH() + step);
  if (x1 <= x0 || y1 <= y0) { ctx.restore(); return; }
  ctx.fillStyle = dots.color;
  const sx = Math.floor(x0 / step) * step, sy = Math.floor(y0 / step) * step;
  ctx.beginPath();
  for (let y = sy; y <= y1; y += step)
    for (let x = sx; x <= x1; x += step) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7); }
  ctx.fill();
  ctx.restore();
}

// Штрих засечки-маркера чуть тоньше самой линии (см. drawLineMarkers).
// Единая величина с scene.py MARKER_WIDTH_RATIO — холст и печать не должны
// расходиться по толщине галок.
const MARKER_WIDTH_RATIO = 0.65;

// Одна засечка в экранной точке (px,py): касательная (tx,ty), нормаль
// внутрь (nx,ny). Формы: tick ⊢, tee ⊥, corner Г, chevron ∨, chevron_dot ∨.,
// triangle ▼, dot ●, square ■, diamond ◇.
function drawMarkerGlyph(mk, px, py, tx, ty, nx, ny, s, period) {
  const shape = mk.shape;
  // Толщина штриха маркера = его собственная (mk.ow из QML outline_width),
  // а не толщина линии — иначе засечки-штрихи выходят волоском и не читаются
  // (код 9 при этом вообще исчезал). Залитые формы (▼/●) ow не используют.
  if (mk.ow) ctx.lineWidth = mk.ow;
  ctx.beginPath();
  switch (shape) {
    case "tee":
      ctx.moveTo(px, py); ctx.lineTo(px + nx * s, py + ny * s);
      ctx.moveTo(px - tx * s * 0.5, py - ty * s * 0.5);
      ctx.lineTo(px + tx * s * 0.5, py + ty * s * 0.5);
      ctx.stroke(); break;
    case "corner":
      ctx.moveTo(px, py); ctx.lineTo(px + nx * s, py + ny * s);
      ctx.lineTo(px + nx * s + tx * s, py + ny * s + ty * s);
      ctx.stroke(); break;
    case "chevron": case "chevron_dot": {
      // Галка-стрелка: УЗКИЙ конец (остриё) НА линии, плечи раскрываются по
      // нормали. Раньше остриё уходило ОТ линии, а плечи стояли на черте —
      // выглядело как «▽», а не как галка, направленная в линию (правка юзера:
      // «узким концом повёрнуты к линии»). Теперь apex = (px,py) на линии.
      const w2 = s * 0.5;
      ctx.moveTo(px + nx * s - tx * w2, py + ny * s - ty * w2);
      ctx.lineTo(px, py);
      ctx.lineTo(px + nx * s + tx * w2, py + ny * s + ty * w2);
      ctx.stroke();
      if (shape === "chevron_dot") {
        ctx.beginPath();
        ctx.arc(px + tx * period / 2 + nx * s * 0.5,
                py + ty * period / 2 + ny * s * 0.5, s * 0.15, 0, 7);
        ctx.fill();
      }
      break;
    }
    case "triangle": {
      // ВЕРШИНА (остриё) НА линии, ОСНОВАНИЕ смещено по нормали внутрь зоны —
      // ровно как на кадре портала gisogd.mos.ru «Границы территорий ПК»
      // (правка юзера: «вершина обращена к линии, а не основание»). Прежде было
      // наоборот (основание на линии, вершина внутрь) — это была ошибка.
      // filled===false → КОНТУРНЫЙ (в QML fill alpha=0: коды 11/18/50).
      const b = s * 0.5;
      ctx.moveTo(px, py);                                    // остриё на линии
      ctx.lineTo(px + nx * s - tx * b, py + ny * s - ty * b);  // угол основания
      ctx.lineTo(px + nx * s + tx * b, py + ny * s + ty * b);  // угол основания
      ctx.closePath();
      if (mk.filled === false) ctx.stroke(); else ctx.fill();
      break;
    }
    case "triangle2": {
      // ООЗТ (код 47) — как ООПТ на эталоне: два залитых треугольника,
      // наложенных со сдвигом «вверх» (по нормали внутрь зоны), не ▲▲ вдоль линии.
      const b = s * 0.5, shift = s * 0.38;
      for (const o of [0, shift]) {
        const cx = px + nx * o, cy = py + ny * o;
        ctx.beginPath();
        ctx.moveTo(cx - tx * b, cy - ty * b);
        ctx.lineTo(cx + tx * b, cy + ty * b);
        ctx.lineTo(cx + nx * s, cy + ny * s);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case "dot":
      ctx.arc(px, py, s / 2, 0, 7); ctx.fill(); break;
    case "square": {
      const b = s / 2;
      ctx.fillRect(px - b, py - b, s, s); break;
    }
    case "diamond": {
      const b = s / 2;
      ctx.moveTo(px - b, py); ctx.lineTo(px, py - b);
      ctx.lineTo(px + b, py); ctx.lineTo(px, py + b);
      ctx.closePath(); ctx.stroke(); break;
    }
    case "slashes": {
      // две параллельные косые засечки «⫽» поперёк линии (Эталон: зоны
      // затопления/подтопления). Наклон по (касательная − нормаль внутрь).
      const dx = tx - nx, dy = ty - ny, dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl, h = s * 0.6, sep = s * 0.45;
      for (const o of [-sep / 2, sep / 2]) {
        const cx = px + tx * o, cy = py + ty * o;
        ctx.moveTo(cx - ux * h, cy - uy * h);
        ctx.lineTo(cx + ux * h, cy + uy * h);
      }
      ctx.stroke(); break;
    }
    default: {  // tick — перпендикулярный штрих
      // Видимый РАЗМАХ засечки = бо́льшая из (длина size, толщина ow), толщина
      // штриха = меньшая. Иначе код 9 (size 0.25px, ow 7px) вырождался в
      // невидимый смаз вдоль линии — жалоба «маркеры не видно».
      const ext = Math.max(s, mk.ow || 0);
      if (mk.ow) ctx.lineWidth = Math.max(0.4, Math.min(s, mk.ow));
      ctx.moveTo(px, py); ctx.lineTo(px + nx * ext, py + ny * ext);
      ctx.stroke();
      break;
    }
  }
}

