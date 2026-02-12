(function(){
  // --- Geo helpers (UTM + reproyección) ---
  function centroidLonLatOfPolygon(gj) {
    const ring = gj.geometry.coordinates[0];
    let sx = 0, sy = 0;
    for (const [lon, lat] of ring) { sx += lon; sy += lat; }
    return [sx / ring.length, sy / ring.length];
  }

  function utmProjForLonLat(lon, lat) {
    const zone = Math.floor((lon + 180) / 6) + 1;
    const south = lat < 0;
    const proj = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs` + (south ? " +south" : "");
    return { proj, zone, south };
  }

  function projectRing(ringLonLat, projDef) {
    return ringLonLat.map(([lon, lat]) => proj4('EPSG:4326', projDef, [lon, lat]));
  }
  function unprojectRing(ringXY, projDef) {
    return ringXY.map(([x, y]) => proj4(projDef, 'EPSG:4326', [x, y]));
  }

  function closeRing(r) {
    if (r.length === 0) return r;
    const [x0, y0] = r[0];
    const [xn, yn] = r[r.length - 1];
    if (x0 === xn && y0 === yn) return r;
    return r.concat([[x0, y0]]);
  }

  // --- Basic geom ---
  function rotatePoint([x, y], [cx, cy], angleRad) {
    const dx = x - cx, dy = y - cy;
    const ca = Math.cos(angleRad), sa = Math.sin(angleRad);
    return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
  }
  function rotateRing(ring, center, angleRad) { return ring.map(p => rotatePoint(p, center, angleRad)); }

  function ringArea(ring) {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      a += (x1 * y2 - x2 * y1);
    }
    return a / 2;
  }
  function polygonAreaXY(poly) {
    const outer = Math.abs(ringArea(closeRing(poly[0])));
    let holes = 0;
    for (let i = 1; i < poly.length; i++) holes += Math.abs(ringArea(closeRing(poly[i])));
    return outer - holes;
  }

  function bboxOfRing(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
  function centerOfBBox(bb) { return [(bb.minX + bb.maxX)/2, (bb.minY + bb.maxY)/2]; }

  // --- Buffer inset (setback) using JSTS ---
  function bufferInsetRingXY(ringXY, setbackMeters) {
    const s = Number(setbackMeters);
    if (!(s > 0)) return closeRing(ringXY);

    const ring = closeRing(ringXY);
    const polyGJ = { type: "Polygon", coordinates: [ring] };

    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();

    const geom = reader.read(polyGJ);
    const inset = geom.buffer(-s);
    if (inset.isEmpty()) return null;

    // If multipolygon, keep largest
    let best = inset;
    if (inset.getGeometryType && inset.getGeometryType() === 'MultiPolygon') {
      let bestArea = -Infinity;
      for (let i = 0; i < inset.getNumGeometries(); i++) {
        const g = inset.getGeometryN(i);
        const a = g.getArea();
        if (a > bestArea) { bestArea = a; best = g; }
      }
    }

    const outGJ = writer.write(best);
    if (!outGJ || outGJ.type !== "Polygon") return null;

    const outRing = outGJ.coordinates[0];
    if (!outRing || outRing.length < 4) return null;
    return outRing; // usually closed
  }

  // --- Grid + clipping ---
  function rectRing(x0, y0, x1, y1) { return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]; }
  function toPcPolygonFromRing(ring) { return [ring]; }

  function generateParcelsForAngle(polygonXY, w, h, gap, minArea, angleDeg) {
    const angleRad = angleDeg * Math.PI / 180;

    const bb0 = bboxOfRing(polygonXY);
    const center = centerOfBBox(bb0);

    const polyRot = rotateRing(polygonXY, center, -angleRad);
    const bb = bboxOfRing(polyRot);

    const stepX = w + gap;
    const stepY = h + gap;
    const margin = Math.max(stepX, stepY) * 2;

    const startX = Math.floor((bb.minX - margin) / stepX) * stepX;
    const endX   = Math.ceil((bb.maxX + margin) / stepX) * stepX;
    const startY = Math.floor((bb.minY - margin) / stepY) * stepY;
    const endY   = Math.ceil((bb.maxY + margin) / stepY) * stepY;

    const subject = polygonClipping;
    const polyPc = toPcPolygonFromRing(polyRot);

    const results = [];
    let sumArea = 0;

    for (let x = startX; x <= endX; x += stepX) {
      for (let y = startY; y <= endY; y += stepY) {
        const rr = rectRing(x, y, x + w, y + h);
        const rectPc = toPcPolygonFromRing(rr);

        const inter = subject.intersection(rectPc, polyPc);
        if (!inter || inter.length === 0) continue;

        for (const poly of inter) {
          const area = polygonAreaXY(poly);
          if (area >= minArea) {
            const polyBack = poly.map(ring => rotateRing(ring, center, +angleRad));
            results.push({ poly: polyBack, area_m2: area });
            sumArea += area;
          }
        }
      }
    }
    return { parcels: results, sumArea };
  }

  // Auto-orientation: coarse + refine
  function autoOrient(polygonXY, w, h, gap, minArea, stepDeg, minCount, maxCount) {
    const step = Math.max(1, Math.floor(Number(stepDeg) || 5));
    let best = { angle: 0, parcels: [], sumArea: 0, score: -Infinity };

    // Coarse search 0..179
    for (let a = 0; a < 180; a += step) {
      const r = generateParcelsForAngle(polygonXY, w, h, gap, minArea, a);
      const count = r.parcels.length;

      const minC = Math.max(0, Number(minCount || 0));
      const maxC = Math.max(0, Number(maxCount || 0));

      const violatesMin = (minC > 0 && count < minC);
      const violatesMax = (maxC > 0 && count > maxC);
      if (violatesMin || violatesMax) continue;

      const score = count * 1e9 + r.sumArea; // prioriza nº parcelas, luego área
      if (score > best.score) best = { angle: a, parcels: r.parcels, sumArea: r.sumArea, score };
    }

    // Refine around best angle +/- step (1-degree)
    const start = Math.max(0, best.angle - step);
    const end = Math.min(179, best.angle + step);
    for (let a = start; a <= end; a += 1) {
      const r = generateParcelsForAngle(polygonXY, w, h, gap, minArea, a);
      const count = r.parcels.length;

      const minC = Math.max(0, Number(minCount || 0));
      const maxC = Math.max(0, Number(maxCount || 0));

      const violatesMin = (minC > 0 && count < minC);
      const violatesMax = (maxC > 0 && count > maxC);
      if (violatesMin || violatesMax) continue;

      const score = count * 1e9 + r.sumArea; // prioriza nº parcelas, luego área
      if (score > best.score) best = { angle: a, parcels: r.parcels, sumArea: r.sumArea, score };
    }

    best.satisfied = (best.score > -Infinity);
    return best;
  }

  // Area from ring (closed)
  function areaOfRingXY(ringXY) {
    return Math.abs(ringArea(closeRing(ringXY)));
  }

  window.SmartGeometry = {
    centroidLonLatOfPolygon,
    utmProjForLonLat,
    projectRing,
    unprojectRing,
    closeRing,
    bufferInsetRingXY,
    generateParcelsForAngle,
    autoOrient,
    areaOfRingXY
  };
})();