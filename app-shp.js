"use strict";
// ---------- читалка Shapefile: .shp + .dbf (+.prj, +.cpg), ZIP ----------
// Выгрузки Росреестра и муниципалитетов приходят шейпами, чаще пачкой в
// ZIP и с DBF в cp1251. Всё разбирается на месте, без библиотек: SHP —
// бинарный (типы точка/линия/полигон, включая Z/M — высоты отбрасываются),
// DBF — dBASE III с кодировкой из .cpg или по пробе utf-8 → cp1251,
// PRJ — WKT (разбор в GRADO_CRS_RU). Выход — GeoJSON в СК файла + def СК.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;

  // ---------- DBF (он же .dat у MapInfo) ----------
  function decodeText(bytes, encoding) {
    if (encoding) return new TextDecoder(encoding).decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("windows-1251").decode(bytes); }
  }
  // binTypes: переопределение типов по именам полей — .dat MapInfo пишет
  // числа БИНАРНО (int/int64/double LE), хотя дескрипторы врут «C»; истинные
  // типы объявлены в .tab и передаются сюда читалкой TAB
  function parseDbf(buffer, encoding, binTypes) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (buffer.byteLength < 32) throw new Error("DBF обрезан");
    const numRecords = view.getUint32(4, true);
    const headerSize = view.getUint16(8, true);
    const recordSize = view.getUint16(10, true);
    // кодовая страница из байта LDID, если .cpg не приехал
    const ldid = bytes[29];
    const byLdid = { 0xc9: "windows-1251", 0x26: "ibm866", 0x65: "ibm866" }[ldid];
    const enc = encoding || byLdid || null;
    const fields = [];
    for (let off = 32; off + 32 <= headerSize && bytes[off] !== 0x0d; off += 32) {
      let name = "";
      for (let i = 0; i < 11 && bytes[off + i]; i++) name += String.fromCharCode(bytes[off + i]);
      fields.push({ name: decodeText(new TextEncoder().encode(name), null) || name,
        rawName: name, type: String.fromCharCode(bytes[off + 11]),
        length: bytes[off + 16], decimals: bytes[off + 17] });
    }
    // имена полей тоже бывают в cp1251 — перечитываем байтами
    for (const f of fields) {
      const raw = [];
      for (let i = 0; i < f.rawName.length; i++) raw.push(f.rawName.charCodeAt(i) & 0xff);
      f.name = decodeText(new Uint8Array(raw), enc).trim() || f.rawName;
    }
    const rows = [];
    let off = headerSize;
    for (let r = 0; r < numRecords && off + recordSize <= buffer.byteLength; r++, off += recordSize) {
      if (bytes[off] === 0x2a) continue;              // помеченная удалённой
      const row = {};
      let pos = off + 1;
      for (const f of fields) {
        const chunk = bytes.subarray(pos, pos + f.length);
        const binType = binTypes && binTypes[f.name.toLowerCase()];
        if (binType) {
          const dv = new DataView(buffer, pos);
          row[f.name] = binType === "i16" ? dv.getInt16(0, true)
            : binType === "i32" ? dv.getInt32(0, true)
            : binType === "i64" ? Number(dv.getBigInt64(0, true))
            : binType === "f64" ? dv.getFloat64(0, true)
            : binType === "logical" ? chunk[0] !== 0
            : decodeText(chunk, enc).replace(/\0+/g, "").trim();
          pos += f.length;
          continue;
        }
        pos += f.length;
        // .dat MapInfo добивает строки NUL-ами вместо пробелов
        const text = decodeText(chunk, enc).replace(/\0+/g, "").trim();
        if (text === "") { row[f.name] = null; continue; }
        if (f.type === "N" || f.type === "F") {
          const n = parseFloat(text.replace(",", "."));
          row[f.name] = Number.isFinite(n) ? n : text;
        } else if (f.type === "L") {
          row[f.name] = /^[TtYyДд]/.test(text);
        } else if (f.type === "D" && /^\d{8}$/.test(text)) {
          row[f.name] = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
        } else row[f.name] = text;
      }
      rows.push(row);
    }
    return { fields: fields.map(f => f.name), rows };
  }

  // ---------- SHP ----------
  function shpRings(view, off, numParts, numPoints, partsOff, pointsOff) {
    const parts = [];
    for (let p = 0; p < numParts; p++) {
      const start = view.getInt32(partsOff + p * 4, true);
      const end = p + 1 < numParts ? view.getInt32(partsOff + (p + 1) * 4, true) : numPoints;
      const chain = [];
      for (let i = start; i < end; i++)
        chain.push([view.getFloat64(pointsOff + i * 16, true),
          view.getFloat64(pointsOff + i * 16 + 8, true)]);
      parts.push(chain);
    }
    return parts;
  }
  const ringArea = ring => {
    let s = 0;
    for (let i = 0; i + 1 < ring.length; i++)
      s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return s / 2;
  };
  const pointInRing = (pt, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) &&
          pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // Кольца шейпа: по часовой — внешние, против — дыры; дыра прикрепляется
  // к внешнему кольцу, внутри которого лежит её первая точка
  function assemblePolygons(rings) {
    const outers = [], holes = [];
    for (const ring of rings) (ringArea(ring) < 0 ? outers : holes).push(ring);
    if (!outers.length) return rings.length ? [{ type: "Polygon", coordinates: rings }] : [];
    const polys = outers.map(o => [o]);
    for (const hole of holes) {
      const host = polys.find(p => pointInRing(hole[0], p[0]));
      (host || polys[0]).push(hole);
    }
    return polys.map(coordinates => ({ type: "Polygon", coordinates }));
  }
  function parseShp(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 100 || view.getInt32(0, false) !== 9994)
      throw new Error("Это не файл .shp");
    const geoms = [];
    let off = 100;
    while (off + 8 <= buffer.byteLength) {
      const contentLen = view.getInt32(off + 4, false) * 2;
      const rec = off + 8;
      if (rec + contentLen > buffer.byteLength) break;
      const type = view.getInt32(rec, true);
      let geometry = null;
      if (type === 1 || type === 11 || type === 21) {
        geometry = { type: "Point",
          coordinates: [view.getFloat64(rec + 4, true), view.getFloat64(rec + 12, true)] };
      } else if (type === 8 || type === 18 || type === 28) {
        const n = view.getInt32(rec + 36, true);
        const pts = [];
        for (let i = 0; i < n; i++)
          pts.push([view.getFloat64(rec + 40 + i * 16, true),
            view.getFloat64(rec + 48 + i * 16, true)]);
        geometry = { type: "MultiPoint", coordinates: pts };
      } else if ([3, 5, 13, 15, 23, 25].includes(type)) {
        const numParts = view.getInt32(rec + 36, true);
        const numPoints = view.getInt32(rec + 40, true);
        const parts = shpRings(view, rec, numParts, numPoints, rec + 44, rec + 44 + numParts * 4);
        if (type === 3 || type === 13 || type === 23) {
          geometry = parts.length === 1
            ? { type: "LineString", coordinates: parts[0] }
            : { type: "MultiLineString", coordinates: parts };
        } else {
          const polys = assemblePolygons(parts).filter(Boolean);
          geometry = polys.length === 1 ? polys[0]
            : { type: "MultiPolygon", coordinates: polys.map(p => p.coordinates) };
        }
      }
      // type 0 (null) и неизвестные просто пропускаются, место в списке держим
      geoms.push(geometry);
      off = rec + contentLen;
    }
    return geoms;
  }

  // ---------- ZIP (только stored и deflate, через DecompressionStream) ----
  async function unzip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // центральный каталог с конца
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--)
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("ZIP повреждён: нет каталога");
    const count = view.getUint16(eocd + 10, true);
    let off = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(off, true) !== 0x02014b50) break;
      const method = view.getUint16(off + 10, true);
      const compSize = view.getUint32(off + 20, true);
      const nameLen = view.getUint16(off + 28, true);
      const extraLen = view.getUint16(off + 30, true);
      const commentLen = view.getUint16(off + 32, true);
      const localOff = view.getUint32(off + 42, true);
      const flags = view.getUint16(off + 8, true);
      const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen);
      const name = (flags & 0x800) ? new TextDecoder().decode(nameBytes)
        : decodeText(nameBytes, null);
      // локальный заголовок — свои длины имён
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.slice(dataOff, dataOff + compSize);
      if (method === 0) files[name] = raw.buffer;
      else if (method === 8) {
        const stream = new Blob([raw]).stream()
          .pipeThrough(new DecompressionStream("deflate-raw"));
        files[name] = await new Response(stream).arrayBuffer();
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  // ---------- сборка: набор файлов одного шейпа → GeoJSON + СК ----------
  function readCpg(buffer) {
    if (!buffer) return null;
    const text = new TextDecoder().decode(buffer).trim().toLowerCase();
    if (/1251/.test(text)) return "windows-1251";
    if (/866/.test(text)) return "ibm866";
    if (/utf-?8/.test(text)) return "utf-8";
    return null;
  }
  // files: { shp: ArrayBuffer, dbf?, prj?: string|ArrayBuffer, cpg? }
  function readShapefile(files) {
    if (!files.shp) throw new Error("Не хватает файла .shp");
    const geoms = parseShp(files.shp);
    const table = files.dbf ? parseDbf(files.dbf, readCpg(files.cpg)) : { fields: [], rows: [] };
    const crsRu = root.GRADO_CRS_RU;
    const prjText = typeof files.prj === "string" ? files.prj
      : files.prj ? new TextDecoder().decode(files.prj) : null;
    const crsDef = prjText && crsRu ? crsRu.parsePrj(prjText) : null;
    const features = geoms.map((geometry, i) => geometry && ({
      type: "Feature", geometry, properties: table.rows[i] || {} })).filter(Boolean);
    return { type: "FeatureCollection", features, crsDef,
      prjUnparsed: !!(prjText && !crsDef) };
  }

  root.GRADO_SHP = { parseShp, parseDbf, readShapefile, unzip, readCpg, decodeText,
    assemblePolygons };
})();
