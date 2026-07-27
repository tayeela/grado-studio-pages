// Градуированная символика — «Graduated» из QGIS: числовое поле разбивается на
// диапазоны, каждому диапазону свой цвет.
//
// Зачем. Этажность, плотность, площадь участка, год постройки — по ним чертёж
// читается только в цвете. Категории (по значению поля) для этого не годятся:
// у 20 000 зданий 40 разных этажностей, и список категорий превращается
// в мусор.
//
// Ядро — чистые функции: классификация, палитры, сборка правил. Работают
// в Node и покрыты тестом.
(function (root) {
  "use strict";

  const METHODS = {
    equal: { label: "Равные интервалы", help: "Диапазон значений делится поровну." },
    quantile: { label: "Квантили", help: "В каждом классе поровну объектов." },
    jenks: { label: "Естественные границы", help: "Границы по разрывам в данных (Jenks)." },
  };

  // Палитры последовательные: тёмный конец — большие значения. Цвета берутся
  // из проверенных наборов ColorBrewer, чтобы шкала читалась и в печати.
  const RAMPS = {
    "yellow-red": { label: "Жёлтый → красный", stops: ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"] },
    "green-red": { label: "Зелёный → красный", stops: ["#1a9641", "#a6d96a", "#ffffbf", "#fdae61", "#d7191c"] },
    "white-blue": { label: "Белый → синий", stops: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"] },
    "sand-brown": { label: "Песочный → коричневый", stops: ["#f6e8c3", "#dfc27d", "#bf812d", "#8c510a", "#543005"] },
    grey: { label: "Серый", stops: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"] },
  };
  // Ступени палитр взяты из ColorBrewer, но две были собраны из НЕ ТОГО набора:
  // «Серый» и «Белый → синий» составили из подряд идущих ступеней 9-классовых
  // схем, а не из готовых 5-классовых. Разница видна на карте: у «Серого» шаг
  // светлоты между первыми тремя классами был 8 и 10 единиц L*, а между
  // последними — 28 и 34. Три класса из пяти читались как один серый, то есть
  // карта врала о различиях, которые в данных есть. Замерено (разброс
  // max/min по шагу L*): «Серый» 4.2× → 1.8×, «Белый → синий» 2.1× → 1.5×.
  // Сторож — tests/ramp-lightness.test.js.

  const num = value => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };

  function numericValues(features, field) {
    const out = [];
    for (const feature of features) {
      const value = num((feature.props || {})[field]);
      if (value !== null) out.push(value);
    }
    return out.sort((a, b) => a - b);
  }

  // Границы классов: массив из classes+1 числа (нижняя граница первого …
  // верхняя граница последнего).
  function classify(values, { method = "equal", classes = 5 } = {}) {
    const sorted = values.slice().sort((a, b) => a - b);
    const count = Math.max(2, Math.min(12, Math.round(classes)));
    if (sorted.length < 2) return sorted.length ? [sorted[0], sorted[0]] : [];
    const min = sorted[0], max = sorted[sorted.length - 1];
    if (min === max) return [min, max];
    if (method === "quantile") {
      const breaks = [min];
      for (let i = 1; i < count; i++) {
        const at = (sorted.length - 1) * (i / count);
        const low = Math.floor(at), high = Math.ceil(at);
        breaks.push(sorted[low] + (sorted[high] - sorted[low]) * (at - low));
      }
      breaks.push(max);
      return dedupeBreaks(breaks);
    }
    if (method === "jenks") return dedupeBreaks(jenks(sorted, count));
    const step = (max - min) / count;
    const breaks = [];
    for (let i = 0; i <= count; i++) breaks.push(min + step * i);
    return dedupeBreaks(breaks);
  }

  // Совпавшие границы схлопываем: класс нулевой ширины не поймает ни одного
  // объекта и в легенде выглядит поломкой.
  //
  // Кроме ПОСЛЕДНЕГО. Верхний класс замкнут с обеих сторон — [предпоследняя,
  // максимум], — поэтому при равных границах он не пуст, а содержит все
  // объекты со значением, равным максимуму. Схлопывание его убивало: на наборе
  // 1,1,1,2,2,2,3,3,10,11,12,50,51,52,100 метод правильно выделял 100 в
  // отдельный класс (границы 1, 10, 50, 100, 100), а сюда доезжало 1, 10, 50 —
  // три класса вместо четырёх, и одинокий выброс молча слипался с группой
  // 50–52. Ровно ради выбросов градуированную символику и включают.
  //
  // Границы больше НЕ округляются. Округление здесь путало две разные задачи:
  // читаемость легенды и принадлежность объекта классу. Границы — это реальные
  // значения из данных, и сдвиг на тысячную переводил пограничные объекты в
  // соседний класс, а верхнюю границу уводил ВНИЗ от настоящего максимума
  // (940.7352 → 940.735): самый крупный объект переставал попадать хоть
  // куда-нибудь, потому что `parsed <= rule.max` для него ложь. Замер на
  // дробных данных — по одному-два объекта без класса, и всегда среди них
  // самый крупный, то есть тот, ради которого карту и смотрят. На экране он
  // оставался неокрашенным, без единого слова. За читаемость и так отвечает
  // formatBound в подписи класса — округлять данные ради подписи незачем.
  function dedupeBreaks(breaks) {
    const out = [];
    for (let i = 0; i < breaks.length; i++) {
      const value = breaks[i];
      const последняя = i === breaks.length - 1;
      if (!out.length || value > out[out.length - 1]) { out.push(value); continue; }
      if (последняя && out.length > 1 && value === out[out.length - 1]) out.push(value);
    }
    return out.length > 1 ? out : breaks.slice(0, 2);
  }

  // Естественные границы Фишера-Дженкса.
  //
  // Прежняя реализация считала ту же задачу перебором пар — O(n²·k), — и
  // поэтому прореживала выборку до 1200 значений, утверждая, что «на границах
  // классов это не сказывается». Сверка с эталонным ckmeans из
  // simple-statistics показала, что сказывается, и сильно. Мера — сумма
  // внутриклассовых квадратов отклонений (та самая, которую метод и
  // минимизирует), чем меньше, тем лучше разбивка:
  //
  //   площадь, тяжёлый хвост, 50 000 значений   — хуже эталона на 17 %
  //   две группы, 50 000 значений               — хуже на 64 %
  //   почти одно значение и редкие выбросы      — хуже в 37 раз
  //
  // Последний случай и есть городская выгрузка: тысячи участков одинаковой
  // застройки и десяток особых. Проредили — выбросов в выборке осталось
  // единицы, границы встали не туда, и карта показала не то, что в данных.
  //
  // Считаем теперь без прореживания и точно. Стоимость отрезка берётся из
  // префиксных сумм за O(1), а слой динамики решается «разделяй и властвуй»:
  // оптимальная точка разреза монотонна по правому концу, поэтому диапазон
  // поиска делится пополам вместе с отрезком. Выходит O(k·n·log n) вместо
  // O(n²·k) — 50 000 значений считаются за единицы миллисекунд, и считаются
  // ЦЕЛИКОМ. Сверено с ckmeans на пяти распределениях: разбивка совпадает.
  function jenks(sorted, classes) {
    const n = sorted.length;
    if (n <= classes) return [sorted[0], sorted[n - 1]];
    const s1 = new Float64Array(n + 1), s2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      s1[i + 1] = s1[i] + sorted[i];
      s2[i + 1] = s2[i] + sorted[i] * sorted[i];
    }
    // разброс внутри полуинтервала [a, b) — через суммы, без второго прохода
    const cost = (a, b) => {
      const count = b - a;
      if (count <= 0) return 0;
      const sum = s1[b] - s1[a];
      return Math.max(0, (s2[b] - s2[a]) - (sum * sum) / count);
    };
    let prev = new Float64Array(n + 1).fill(Infinity);
    prev[0] = 0;
    const starts = [];                     // starts[j][i] — начало последнего класса
    for (let j = 1; j <= classes; j++) {
      const cur = new Float64Array(n + 1).fill(Infinity);
      const at = new Int32Array(n + 1);
      const solve = (lo, hi, optLo, optHi) => {
        if (lo > hi) return;
        const mid = (lo + hi) >> 1;
        let best = Infinity, bestAt = optLo;
        const top = Math.min(mid - 1, optHi);
        for (let m = optLo; m <= top; m++) {
          if (prev[m] === Infinity) continue;
          const value = prev[m] + cost(m, mid);
          if (value < best) { best = value; bestAt = m; }
        }
        cur[mid] = best; at[mid] = bestAt;
        solve(lo, mid - 1, optLo, bestAt);
        solve(mid + 1, hi, bestAt, optHi);
      };
      solve(j, n, j - 1, n - 1);
      starts.push(at);
      prev = cur;
    }
    const breaks = new Array(classes + 1);
    breaks[classes] = sorted[n - 1];
    let end = n;
    for (let j = classes; j >= 1; j--) {
      const start = starts[j - 1][end];
      breaks[j - 1] = sorted[start];
      end = start;
    }
    return breaks;
  }

  // Цвета под число классов: палитра из пяти опорных цветов растягивается или
  // прореживается линейной интерполяцией в sRGB.
  function rampColors(name, count) {
    const ramp = RAMPS[name] || RAMPS["yellow-red"];
    const stops = ramp.stops;
    const n = Math.max(1, Math.round(count));
    if (n === 1) return [stops[stops.length - 1]];
    const out = [];
    for (let i = 0; i < n; i++) {
      const at = (i / (n - 1)) * (stops.length - 1);
      const low = Math.floor(at), high = Math.min(stops.length - 1, low + 1);
      out.push(mixHex(stops[low], stops[high], at - low));
    }
    return out;
  }

  const hexToRgb = hex => {
    const clean = String(hex).replace("#", "");
    const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  const toHex = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  function mixHex(from, to, t) {
    const a = hexToRgb(from), b = hexToRgb(to);
    return "#" + a.map((channel, i) => toHex(channel + (b[i] - channel) * t)).join("");
  }

  // Правила для слоя: диапазон → патч оформления. Верхняя граница включается
  // только у последнего класса, иначе объект на границе попал бы в два класса.
  function graduatedRules({ field, breaks, colors, target = "fill", label }) {
    const rules = [];
    for (let i = 0; i + 1 < breaks.length; i++) {
      const patch = {};
      patch[target] = colors[i] || colors[colors.length - 1];
      if (target === "fill") patch.stroke = mixHex(patch.fill, "#000000", 0.35);
      rules.push({ field, min: breaks[i], max: breaks[i + 1],
        last: i + 2 === breaks.length, patch,
        title: `${formatBound(breaks[i])} – ${formatBound(breaks[i + 1])}${label ? " " + label : ""}` });
    }
    return rules;
  }

  const formatBound = value => {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("ru-RU");
    return String(Math.round(value * 100) / 100);
  };

  // Попадание значения в правило-диапазон: нижняя граница включена, верхняя —
  // только у последнего класса.
  function ruleMatchesValue(rule, value) {
    const parsed = num(value);
    if (parsed === null) return false;
    if (parsed < rule.min) return false;
    return rule.last ? parsed <= rule.max : parsed < rule.max;
  }

  function buildGraduated(features, { field, method = "equal", classes = 5, ramp = "yellow-red",
    target = "fill", label } = {}) {
    const values = numericValues(features, field);
    if (values.length < 2) return { rules: [], breaks: [], reason: "в поле меньше двух числовых значений" };
    if (values[0] === values[values.length - 1])
      return { rules: [], breaks: [], reason: "все значения одинаковы" };
    const breaks = classify(values, { method, classes });
    if (breaks.length < 2) return { rules: [], breaks, reason: "все значения одинаковы" };
    const colors = rampColors(ramp, breaks.length - 1);
    return { rules: graduatedRules({ field, breaks, colors, target, label }), breaks, colors, reason: null,
      counted: values.length };
  }

  root.GRADO_SYMBOLOGY = { METHODS, RAMPS, classify, jenks, rampColors, mixHex,
    graduatedRules, ruleMatchesValue, numericValues, buildGraduated, formatBound };
})(typeof window !== "undefined" ? window : globalThis);
