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
    "white-blue": { label: "Белый → синий", stops: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"] },
    "sand-brown": { label: "Песочный → коричневый", stops: ["#f6e8c3", "#dfc27d", "#bf812d", "#8c510a", "#543005"] },
    grey: { label: "Серый", stops: ["#f0f0f0", "#d9d9d9", "#bdbdbd", "#737373", "#252525"] },
  };

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
  function dedupeBreaks(breaks) {
    const out = [];
    for (const value of breaks) {
      const rounded = Math.abs(value) >= 1000 ? Math.round(value)
        : Math.round(value * 1000) / 1000;
      if (!out.length || rounded > out[out.length - 1]) out.push(rounded);
    }
    return out.length > 1 ? out : breaks.slice(0, 2);
  }

  // Естественные границы Фишера-Дженкса. На городских выгрузках значений
  // десятки тысяч, а сложность метода квадратичная по числу значений, поэтому
  // выборка прореживается: на границах классов это не сказывается.
  function jenks(sorted, classes) {
    const MAX = 1200;
    const data = sorted.length > MAX
      ? Array.from({ length: MAX }, (_, i) => sorted[Math.floor(i * (sorted.length - 1) / (MAX - 1))])
      : sorted;
    const n = data.length;
    if (n <= classes) return [data[0], data[n - 1]];
    const matrix = [], variance = [];
    for (let i = 0; i <= n; i++) {
      matrix.push(new Array(classes + 1).fill(0));
      variance.push(new Array(classes + 1).fill(Infinity));
    }
    for (let j = 1; j <= classes; j++) {
      matrix[1][j] = 1;
      variance[1][j] = 0;
      for (let i = 2; i <= n; i++) variance[i][j] = Infinity;
    }
    for (let l = 2; l <= n; l++) {
      let sum = 0, sumSquares = 0, count = 0, deviation = 0;
      for (let m = 1; m <= l; m++) {
        const lower = l - m + 1;
        const value = data[lower - 1];
        count += 1;
        sum += value;
        sumSquares += value * value;
        deviation = sumSquares - (sum * sum) / count;
        if (lower === 1) continue;
        for (let j = 2; j <= classes; j++)
          if (variance[l][j] >= deviation + variance[lower - 1][j - 1]) {
            matrix[l][j] = lower;
            variance[l][j] = deviation + variance[lower - 1][j - 1];
          }
      }
      matrix[l][1] = 1;
      variance[l][1] = deviation;
    }
    const breaks = new Array(classes + 1);
    breaks[classes] = data[n - 1];
    breaks[0] = data[0];
    let k = n;
    for (let j = classes; j >= 2; j--) {
      const id = matrix[k][j] - 1;
      breaks[j - 1] = data[id];
      k = matrix[k][j] - 1;
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
