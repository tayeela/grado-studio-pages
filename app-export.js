// Экспорт слоя и его оформления наружу: GeoJSON + QML.
//
// Зачем. Обмен с QGIS был односторонним: студия читала GeoJSON и эталонные QML,
// но отдать слой обратно не могла — оформление, собранное здесь (категории,
// диапазоны, подписи), приходилось повторять в QGIS руками.
//
// GeoJSON пишется в WGS84 — так его прочитает любая программа без вопросов
// о системе координат. QML описывает ровно то, что видно на холсте: единый
// знак, категории по значению поля или диапазоны, плюс подписи.
(function (root) {
  "use strict";

  const esc = value => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

  // ---------- цвет ----------
  // QGIS пишет цвет как «R,G,B,A». Наши стили держат #rrggbb, rgba(...) и
  // цвета с альфой в hex — приводим всё к одному виду.
  function toQgisColor(value, fallback = "0,0,0,255") {
    if (!value) return fallback;
    const text = String(value).trim();
    const rgba = /^rgba?\(([^)]+)\)$/i.exec(text);
    if (rgba) {
      const parts = rgba[1].split(",").map(part => parseFloat(part.trim()));
      const alpha = parts.length > 3 ? Math.round(Math.max(0, Math.min(1, parts[3])) * 255) : 255;
      return `${Math.round(parts[0])},${Math.round(parts[1])},${Math.round(parts[2])},${alpha}`;
    }
    const hex = text.replace("#", "");
    if (!/^[0-9a-f]{3,8}$/i.test(hex)) return fallback;
    const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    const alpha = full.length >= 8 ? parseInt(full.slice(6, 8), 16) : 255;
    return `${red},${green},${blue},${alpha}`;
  }

  // Толщина у нас в экранных пикселях опорного масштаба, QML — в миллиметрах
  // листа. 1 px при 96 dpi = 0.2646 мм; это тот же коэффициент, с которым
  // эталонные знаки читались обратно.
  const PX_TO_MM = 25.4 / 96;
  const mm = value => (Math.max(0, Number(value) || 0) * PX_TO_MM).toFixed(3);

  // ---------- GeoJSON ----------
  // Геометрия отдаётся в WGS84: GeoJSON без указания системы координат по
  // стандарту читается именно так, и QGIS не спросит проекцию.
  function featureGeometry(feature, toLonLat) {
    const point = p => { const [lon, lat] = toLonLat(p[0], p[1]); return [round(lon), round(lat)]; };
    const ring = r => {
      const out = r.map(point);
      if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]))
        out.push([...out[0]]);
      return out;
    };
    if (Array.isArray(feature.ring))
      return { type: "Polygon", coordinates: [ring(feature.ring), ...(feature.holes || []).map(ring)] };
    if (Array.isArray(feature.line)) return { type: "LineString", coordinates: feature.line.map(point) };
    if (Array.isArray(feature.point)) return { type: "Point", coordinates: point(feature.point) };
    if (feature.circle || feature.arc) {
      // дуга и окружность в GeoJSON не существуют — отдаём разбиение по точкам
      const points = typeof root.featurePts === "function" ? root.featurePts(feature) : null;
      if (points && points.length > 1) {
        const line = points.map(point);
        return feature.circle
          ? { type: "Polygon", coordinates: [ring(points)] }
          : { type: "LineString", coordinates: line };
      }
    }
    return null;
  }
  const round = value => Math.round(value * 1e7) / 1e7;   // ~1 см по долготе

  function layerToGeoJson(layer, features, { toLonLat, fields } = {}) {
    const convert = toLonLat || ((x, y) => [x, y]);
    const out = [];
    let skipped = 0;
    for (const feature of features) {
      const geometry = featureGeometry(feature, convert);
      if (!geometry) { skipped += 1; continue; }
      const props = {};
      for (const [key, value] of Object.entries(feature.props || {})) {
        if (key.startsWith("_")) continue;               // служебные поля наружу не идут
        props[key] = value;
      }
      out.push({ type: "Feature", geometry, properties: props });
    }
    return {
      collection: { type: "FeatureCollection",
        name: layer ? layer.title : "слой",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        fields: fields || undefined,
        features: out },
      skipped,
    };
  }

  // ---------- QML ----------
  const symbolLayer = (style, geometry) => {
    if (geometry === "point") return {
      klass: "SimpleMarker",
      props: { name: "circle", color: toQgisColor(style.fill || style.stroke, "47,111,222,255"),
        outline_color: toQgisColor(style.stroke, "29,74,158,255"),
        outline_width: mm(style.width || 1), outline_width_unit: "MM",
        size: mm(((style.marker && style.marker.size) || 4) * 2), size_unit: "MM" },
    };
    if (geometry === "polygon") return {
      klass: "SimpleFill",
      props: { style: style.fill ? "solid" : "no",
        color: toQgisColor(style.fill, "255,255,255,0"),
        outline_color: toQgisColor(style.stroke, "60,60,60,255"),
        outline_width: mm(style.width || 1), outline_width_unit: "MM",
        outline_style: dashStyle(style) },
    };
    return {
      klass: "SimpleLine",
      props: { line_color: toQgisColor(style.stroke, "60,60,60,255"),
        line_width: mm(style.width || 1), line_width_unit: "MM",
        line_style: dashStyle(style),
        customdash: (style.dash || []).map(value => mm(value)).join(";"),
        use_custom_dash: style.dash && style.dash.length ? "1" : "0" },
    };
  };
  const dashStyle = style => (style.dash && style.dash.length ? "dash" : "solid");

  const symbolXml = (style, geometry, name) => {
    const type = geometry === "point" ? "marker" : geometry === "polygon" ? "fill" : "line";
    const layerXml = symbolLayer(style, geometry);
    const props = Object.entries(layerXml.props)
      .map(([key, value]) => `          <Option type="QString" name="${esc(key)}" value="${esc(value)}"/>`)
      .join("\n");
    return `      <symbol type="${type}" name="${esc(name)}" alpha="1" clip_to_extent="1">
        <layer class="${layerXml.klass}" enabled="1" pass="0" locked="0">
          <Option type="Map">
${props}
          </Option>
        </layer>
      </symbol>`;
  };

  // Подписи: в QML это отдельный блок labeling, а не свойство знака.
  const labelingXml = style => {
    if (!style.label_field) return "";
    const font = style.label_font || {};
    return `  <labeling type="simple">
    <settings>
      <text-style fontSize="${esc(font.size || 11)}" fontFamily="Sans Serif"
        textColor="${esc(toQgisColor(font.color, "92,90,84,255"))}" fieldName="${esc(style.label_field)}"/>
      <placement placement="${style.label_field ? 0 : 0}"/>
    </settings>
  </labeling>`;
  };

  // Три вида отрисовщика — ровно те, что есть в студии: единый знак,
  // категории по значению поля, диапазоны.
  function rendererXml(layer, style, geometry, context = {}) {
    const ranges = (layer.rules || []).filter(rule => rule && rule.patch && rule.min !== undefined);
    if (ranges.length) {
      const rows = ranges.map((rule, index) =>
        `      <range lower="${rule.min}" upper="${rule.max}" symbol="${index}" label="${esc(rule.title || "")}" render="true"/>`).join("\n");
      const symbols = ranges.map((rule, index) =>
        symbolXml({ ...style, ...rule.patch }, geometry, String(index))).join("\n");
      return `  <renderer-v2 type="graduatedSymbol" attr="${esc(ranges[0].field)}" graduatedMethod="GraduatedColor">
    <ranges>
${rows}
    </ranges>
    <symbols>
${symbols}
    </symbols>
  </renderer-v2>`;
    }
    const categories = context.categories || [];
    if (categories.length > 1) {
      const rows = categories.map((category, index) =>
        `      <category value="${esc(category.value)}" symbol="${index}" label="${esc(category.title)}" render="true"/>`).join("\n");
      const symbols = categories.map((category, index) =>
        symbolXml(category.style || style, geometry, String(index))).join("\n");
      return `  <renderer-v2 type="categorizedSymbol" attr="${esc(context.categoryField || "")}">
    <categories>
${rows}
    </categories>
    <symbols>
${symbols}
    </symbols>
  </renderer-v2>`;
    }
    return `  <renderer-v2 type="singleSymbol">
    <symbols>
${symbolXml(style, geometry, "0")}
    </symbols>
  </renderer-v2>`;
  }

  function layerToQml(layer, style, context = {}) {
    const geometry = layer.geometry_type === "point" ? "point"
      : layer.geometry_type === "polygon" ? "polygon" : "line";
    const scaleMax = style.scale_max || (layer.fmt && layer.fmt.scale_max) || 0;
    return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.28" styleCategories="Symbology|Labeling|Rendering"${scaleMax
      ? ` maxScale="0" minScale="${scaleMax}" hasScaleBasedVisibilityFlag="1"` : ""}>
${rendererXml(layer, style, geometry, context)}
${labelingXml(style)}
  <layerGeometryType>${geometry === "point" ? 0 : geometry === "line" ? 1 : 2}</layerGeometryType>
</qgis>
`;
  }

  root.GRADO_EXPORT = { toQgisColor, mm, layerToGeoJson, layerToQml, symbolXml, rendererXml, PX_TO_MM };

  if (typeof document === "undefined") return;

  // ---------- выгрузка файлов ----------
  function saveFile(name, text, type) {
    const blob = new Blob([text], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const safeName = title => String(title || "слой").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);

  function exportLayer(layer, what = "both") {
    if (!layer) { toast("Выберите слой", "warn"); return; }
    const features = state.features.filter(f => layerOf(f) === layer);
    if (!features.length) { toast("В слое нет объектов", "warn"); return; }
    const name = safeName(layer.title);
    if (what === "geojson" || what === "both") {
      const fields = (typeof attrColumns === "function"
        ? attrColumns(layer).filter(c => !c.virtual) : []).map(c => ({ name: c.name, label: c.label, type: c.type }));
      const { collection, skipped } = layerToGeoJson(layer, features,
        { toLonLat: (x, y) => localToLonLat(x, y), fields });
      saveFile(`${name}.geojson`, JSON.stringify(collection), "application/geo+json");
      if (skipped) toast(`${skipped} объектов без геометрии пропущено`, "warn");
    }
    if (what === "qml" || what === "both") {
      // категории берём те же, что показывает легенда: знак у них может
      // отличаться от стиля слоя
      const stats = typeof layerCatStats === "function" ? layerCatStats(layer) : [];
      const categories = stats.length > 1 ? stats.map(stat => ({
        value: stat.id, title: stat.title,
        style: stat.sample ? styleOf(stat.sample) : null,
      })) : [];
      const qml = layerToQml(layer, layerStyle(layer) || {},
        { categories, categoryField: "style_id" });
      saveFile(`${name}.qml`, qml, "application/xml");
    }
    toast(what === "qml" ? `Стиль слоя «${layer.title}» выгружен`
      : what === "geojson" ? `Слой «${layer.title}» выгружен в GeoJSON`
        : `Слой «${layer.title}»: GeoJSON и QML выгружены`);
  }

  root.exportLayerFiles = exportLayer;
})(typeof window !== "undefined" ? window : globalThis);
