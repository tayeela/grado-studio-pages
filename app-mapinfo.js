"use strict";
// ---------- читалка MapInfo: TAB (.tab/.dat/.map/.id) и MIF/MID ----------
// TAB — родной бинарный формат MapInfo; раскладка восстановлена по
// исходникам MITAB/GDAL и проверена на файлах, созданных самим GDAL.
// Главное о .map: файл из блоков по 512 байт; в заголовке (блок со
// смещения 256) — проекция, датум и аффинная привязка целочисленных
// координат: мир = (int − Displ) / Scale. Смещения записей объектов
// берём из .id (int32 на объект — как делает и сам MITAB), вершины
// линий и полигонов лежат в координатных блоках (тип 3) со сжатием
// int16 относительно центра сжатия объекта.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;

  // ---------- .map ----------
  function mapHeader(buffer) {
    const view = new DataView(buffer);
    const H = 256;
    if (buffer.byteLength < H + 512) throw new Error(".map обрезан");
    const header = {
      version: view.getUint16(H + 4, true),
      blockSize: view.getUint16(H + 6, true) || 512,
      xScale: view.getFloat64(H + 112, true),
      yScale: view.getFloat64(H + 120, true),
      xDispl: view.getFloat64(H + 128, true),
      yDispl: view.getFloat64(H + 136, true),
      datumId: view.getUint16(H + 106, true),
      projId: view.getUint8(H + 109),
      ellipsoidId: view.getUint8(H + 110),
      proj: [0, 1, 2, 3, 4].map(i => view.getFloat64(H + 144 + i * 8, true)),
      datum: [0, 1, 2, 3, 4, 5, 6].map(i => view.getFloat64(H + 192 + i * 8, true)),
    };
    return header;
  }
  function mapCrsDef(h) {
    const R = root.GRADO_CRS_RU;
    if (!R) return null;
    let ell = { 3: R.ELLIPSOIDS.krass, 10: R.ELLIPSOIDS.bessel,
      28: R.ELLIPSOIDS.wgs84, 0: R.ELLIPSOIDS.wgs84 }[h.ellipsoidId] || R.ELLIPSOIDS.wgs84;
    let towgs84 = null;
    const d = h.datum;
    if (d.some(v => v !== 0))
      // повороты в .map, как и в CoordSys, с обратным знаком к +towgs84
      towgs84 = [d[0], d[1], d[2], -d[3], -d[4], -d[5], d[6]];
    else if (h.datumId === 1001) { ell = R.ELLIPSOIDS.krass; towgs84 = R.TOWGS84_PULKOVO; }
    if (h.projId === 1) return { kind: "geographic", ell, towgs84 };
    if (h.projId === 10) return { kind: "webmerc" };
    if (h.projId !== 8) return null;
    return { kind: "tmerc", ell, towgs84,
      lon0: h.proj[0], lat0: h.proj[1], k: h.proj[2], x0: h.proj[3], y0: h.proj[4] };
  }

  // чтение length байт координатных данных начиная с ptr, с перескоком по
  // цепочке координатных блоков (следующий блок — int32 по смещению 4)
  function readCoordBytes(buffer, ptr, length) {
    const view = new DataView(buffer);
    const out = new Uint8Array(length);
    let got = 0, pos = ptr;
    while (got < length) {
      const blockStart = Math.floor(pos / 512) * 512;
      if (blockStart + 8 > buffer.byteLength) throw new Error(".map: координаты за концом файла");
      const dataBytes = view.getUint16(blockStart + 2, true);
      const blockEnd = blockStart + 8 + dataBytes;
      const take = Math.min(length - got, blockEnd - pos);
      if (take <= 0) {
        const next = view.getInt32(blockStart + 4, true);
        if (!next || next === blockStart) throw new Error(".map: оборвана цепочка координат");
        pos = next + 8;
        continue;
      }
      out.set(new Uint8Array(buffer, pos, take), got);
      got += take; pos += take;
    }
    return new DataView(out.buffer);
  }

  const OBJ = {
    SYMBOL_C: 0x01, SYMBOL: 0x02, LINE_C: 0x04, LINE: 0x05,
    PLINE_C: 0x07, PLINE: 0x08, REGION_C: 0x0d, REGION: 0x0e,
    MULTIPLINE_C: 0x25, MULTIPLINE: 0x26,
  };
  function readMapGeometries(buffer, idBuffer) {
    const view = new DataView(buffer);
    const h = mapHeader(buffer);
    const toWorld = (ix, iy) =>
      [(ix - h.xDispl) / h.xScale, (iy - h.yDispl) / h.yScale];
    const idView = new DataView(idBuffer);
    const offsets = [];
    for (let i = 0; i + 4 <= idBuffer.byteLength; i += 4) {
      const off = idView.getInt32(i, true);
      if (off > 0) offsets.push(off);
    }
    const geoms = [];
    const notes = [];
    for (const off of offsets) {
      try { geoms.push(readObject(view, buffer, off, toWorld)); }
      catch (error) {
        geoms.push(null);
        notes.push(String(error.message || error));
      }
    }
    return { geoms, header: h, crsDef: mapCrsDef(h), notes };
  }
  function readObject(view, buffer, off, toWorld) {
    const type = view.getUint8(off);
    const blockStart = Math.floor(off / 512) * 512;
    const blockCX = view.getInt32(blockStart + 4, true);
    const blockCY = view.getInt32(blockStart + 8, true);
    let p = off + 1 + 4;                                  // тип + id объекта
    const i16 = () => { const v = view.getInt16(p, true); p += 2; return v; };
    const i32 = () => { const v = view.getInt32(p, true); p += 4; return v; };

    if (type === OBJ.SYMBOL_C)
      return { type: "Point", coordinates: toWorld(blockCX + i16(), blockCY + i16()) };
    if (type === OBJ.SYMBOL)
      return { type: "Point", coordinates: toWorld(i32(), i32()) };
    if (type === OBJ.LINE_C) {
      const a = toWorld(blockCX + i16(), blockCY + i16());
      const b = toWorld(blockCX + i16(), blockCY + i16());
      return { type: "LineString", coordinates: [a, b] };
    }
    if (type === OBJ.LINE)
      return { type: "LineString", coordinates: [toWorld(i32(), i32()), toWorld(i32(), i32())] };

    const compressed = type === OBJ.PLINE_C || type === OBJ.REGION_C || type === OBJ.MULTIPLINE_C;
    const isRegion = type === OBJ.REGION_C || type === OBJ.REGION;
    const isMulti = isRegion || type === OBJ.MULTIPLINE_C || type === OBJ.MULTIPLINE;
    if (![OBJ.PLINE_C, OBJ.PLINE, OBJ.REGION_C, OBJ.REGION,
      OBJ.MULTIPLINE_C, OBJ.MULTIPLINE].includes(type))
      throw new Error(`объект MapInfo типа 0x${type.toString(16)} не поддержан`);

    const coordPtr = i32();
    const coordSize = i32() & 0x3fffffff;                 // старшие биты — флаги
    const numSections = isMulti ? i16() : 1;
    let comprOrgX = 0, comprOrgY = 0;
    if (compressed) { p += 4; comprOrgX = i32(); comprOrgY = i32(); }   // label + центр сжатия
    // MBR/pen/brush дальше не нужны

    const data = readCoordBytes(buffer, coordPtr, coordSize);
    let dp = 0;
    const rd16 = () => { const v = data.getInt16(dp, true); dp += 2; return v; };
    const rd32 = () => { const v = data.getInt32(dp, true); dp += 4; return v; };
    const sections = [];
    if (isMulti) {
      // заголовки секций (V300/V450): вершин i16, флаг i16, MBR, смещение
      for (let s = 0; s < numSections; s++) {
        const numVertices = compressed ? rd16() : rd32();
        if (compressed) { rd16(); dp += 8; rd32(); }        // флаг, MBR, offset
        else { dp += 4 + 16 + 4; }
        sections.push(numVertices);
      }
    } else {
      sections.push(coordSize / (compressed ? 4 : 8));
    }
    const chains = sections.map(count => {
      const pts = [];
      for (let i = 0; i < count; i++) {
        const x = compressed ? comprOrgX + rd16() : rd32();
        const y = compressed ? comprOrgY + rd16() : rd32();
        pts.push(toWorld(x, y));
      }
      return pts;
    });
    if (!isRegion)
      return chains.length === 1 ? { type: "LineString", coordinates: chains[0] }
        : { type: "MultiLineString", coordinates: chains };
    const closed = chains.map(chain => {
      const [f, l] = [chain[0], chain[chain.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) chain.push([f[0], f[1]]);
      return chain;
    });
    const polys = root.GRADO_SHP.assemblePolygons(closed);
    return polys.length === 1 ? polys[0]
      : { type: "MultiPolygon", coordinates: polys.map(poly => poly.coordinates) };
  }

  // ---------- .tab ----------
  function parseTabText(text) {
    const charsetMatch = text.match(/Charset\s+"([^"]+)"/i);
    const coordSys = text.match(/^\s*CoordSys\b.*$/im);
    // Fields: истинные типы колонок .dat (в его dBASE-дескрипторах все «C»,
    // а числа на деле лежат бинарно)
    const binTypes = {};
    const fieldsAt = text.search(/^\s*Fields\s+\d+/im);
    if (fieldsAt >= 0) {
      for (const line of text.slice(fieldsAt).split(/\r?\n/).slice(1)) {
        const m = line.match(/^\s*(\S+)\s+(Char|Integer|SmallInt|LargeInt|Float|Decimal|Logical|Date)\b/i);
        if (!m) { if (line.trim() && !/^\s*\S+\s/.test(line)) break; if (!line.trim()) break; continue; }
        const kind = m[2].toLowerCase();
        const bin = { integer: "i32", smallint: "i16", largeint: "i64",
          float: "f64", logical: "logical" }[kind];
        if (bin) binTypes[m[1].toLowerCase()] = bin;
      }
    }
    return {
      charset: charsetMatch ? charsetMatch[1] : null,
      coordSysLine: coordSys ? coordSys[0] : null,
      binTypes,
    };
  }
  const charsetToEncoding = charset =>
    /cyrillic/i.test(charset || "") ? "windows-1251" : null;

  // files: { tab: string, dat: ArrayBuffer, map: ArrayBuffer, id: ArrayBuffer }
  function readTab(files) {
    for (const need of ["tab", "dat", "map", "id"])
      if (!files[need]) throw new Error(`Комплект TAB не полон: нет файла .${need}`);
    const meta = parseTabText(typeof files.tab === "string" ? files.tab
      : root.GRADO_SHP.decodeText(new Uint8Array(files.tab), null));
    const table = root.GRADO_SHP.parseDbf(files.dat, charsetToEncoding(meta.charset), meta.binTypes);
    const { geoms, crsDef, notes } = readMapGeometries(files.map, files.id);
    // CoordSys в .tab (пишут некоторые сборки) важнее бинарного заголовка
    const fromTab = meta.coordSysLine && root.GRADO_CRS_RU
      ? root.GRADO_CRS_RU.parseMapinfoCoordSys(meta.coordSysLine) : null;
    const features = geoms.map((geometry, i) => geometry && ({
      type: "Feature", geometry, properties: table.rows[i] || {} })).filter(Boolean);
    return { type: "FeatureCollection", features, crsDef: fromTab || crsDef, notes };
  }

  // ---------- MIF/MID ----------
  function parseMif(mifText, midBytes) {
    const lines = mifText.split(/\r?\n/);
    let i = 0;
    let delimiter = "\t", coordSysLine = null, charset = null;
    const columns = [];
    for (; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^Delimiter/i.test(line)) delimiter = (line.match(/"(.)"/) || [, "\t"])[1];
      else if (/^Charset/i.test(line)) charset = (line.match(/"([^"]+)"/) || [])[1];
      else if (/^CoordSys/i.test(line)) coordSysLine = line;
      else if (/^Columns\s+(\d+)/i.test(line)) {
        const n = +line.match(/^Columns\s+(\d+)/i)[1];
        for (let c = 1; c <= n; c++) columns.push(lines[i + c].trim().split(/\s+/)[0]);
        i += n;
      } else if (/^Data\b/i.test(line)) { i++; break; }
    }
    const geoms = [];
    const readPts = count => {
      const pts = [];
      while (pts.length < count && i < lines.length) {
        const parts = lines[i++].trim().split(/\s+/).map(parseFloat);
        if (parts.length >= 2 && parts.every(Number.isFinite)) pts.push([parts[0], parts[1]]);
      }
      return pts;
    };
    while (i < lines.length) {
      const line = lines[i].trim();
      const head = line.split(/\s+/)[0].toLowerCase();
      if (!line || ["pen", "brush", "symbol", "smooth", "center", "font"].includes(head)) { i++; continue; }
      if (head === "point") {
        const parts = line.split(/\s+/).map(parseFloat).filter(Number.isFinite);
        geoms.push({ type: "Point", coordinates: [parts[0], parts[1]] });
        i++;
      } else if (head === "line") {
        const parts = line.split(/\s+/).slice(1).map(parseFloat);
        geoms.push({ type: "LineString", coordinates: [[parts[0], parts[1]], [parts[2], parts[3]]] });
        i++;
      } else if (head === "pline") {
        const multi = /multiple/i.test(line);
        const chains = [];
        if (multi) {
          const count = +line.split(/\s+/).pop();
          i++;
          for (let s = 0; s < count; s++) { const n = +lines[i++].trim(); chains.push(readPts(n)); }
        } else {
          let n = parseInt(line.split(/\s+/)[1], 10);
          i++;
          if (!Number.isFinite(n)) n = parseInt(lines[i++].trim(), 10);
          chains.push(readPts(n));
        }
        geoms.push(chains.length === 1
          ? { type: "LineString", coordinates: chains[0] }
          : { type: "MultiLineString", coordinates: chains });
      } else if (head === "region") {
        const count = +line.split(/\s+/)[1] || 1;
        i++;
        const rings = [];
        for (let s = 0; s < count; s++) {
          const n = +lines[i++].trim();
          const ring = readPts(n);
          if (ring.length && (ring[0][0] !== ring[ring.length - 1][0]
            || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
          rings.push(ring);
        }
        const polys = root.GRADO_SHP.assemblePolygons(rings);
        geoms.push(polys.length === 1 ? polys[0]
          : { type: "MultiPolygon", coordinates: polys.map(poly => poly.coordinates) });
      } else if (head === "none") { geoms.push(null); i++; }
      else i++;
    }
    // MID: значения по разделителю, строки в кавычках
    const rows = [];
    if (midBytes) {
      const midText = root.GRADO_SHP.decodeText(
        midBytes instanceof Uint8Array ? midBytes : new Uint8Array(midBytes),
        charsetToEncoding(charset));
      for (const rawLine of midText.split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        const values = [];
        let cur = "", inQuotes = false;
        for (const ch of rawLine) {
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === delimiter && !inQuotes) { values.push(cur); cur = ""; }
          else cur += ch;
        }
        values.push(cur);
        const row = {};
        columns.forEach((name, c) => {
          const value = values[c] ?? "";
          const num = value !== "" && /^-?[\d.]+$/.test(value) ? parseFloat(value) : null;
          row[name] = num !== null && Number.isFinite(num) ? num : value;
        });
        rows.push(row);
      }
    }
    const crsDef = coordSysLine && root.GRADO_CRS_RU
      ? root.GRADO_CRS_RU.parseMapinfoCoordSys(coordSysLine) : null;
    const features = geoms.map((geometry, index) => geometry && ({
      type: "Feature", geometry, properties: rows[index] || {} })).filter(Boolean);
    return { type: "FeatureCollection", features, crsDef,
      noCoordSys: !coordSysLine };
  }

  root.GRADO_MAPINFO = { readTab, parseMif, readMapGeometries, mapHeader, parseTabText };
})();
