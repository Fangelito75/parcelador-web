(function(){
  const map = L.map('map').setView([40.4168, -3.7038], 12);

  const basemaps = SmartBasemaps.createBasemaps();
  SmartBasemaps.wireBasemapUI(map, basemaps);

  map.pm.addControls({
    position: 'topleft',
    drawCircle: false,
    drawCircleMarker: false,
    drawMarker: false,
    drawRectangle: false,
    cutPolygon: false,
    drawPolyline: false, // measurement line handled by our button
    dragMode: true,
    editMode: true,
    removalMode: true
  });

  let inputLayer = null;

  const parcelsGroup = L.featureGroup().addTo(map);
  const insetLayer   = L.geoJSON(null, { style: { weight: 2, dashArray: '4,6', fillOpacity: 0 } }).addTo(map);
  const measureGroup = L.featureGroup().addTo(map);
  const parcelDistGroup = L.featureGroup().addTo(map);

  // --- UI ---
  const btnGen = document.getElementById('btnGen');
  const btnGeo = document.getElementById('btnGeoJSON');
  const btnShp = document.getElementById('btnSHP');
  const btnMeasure = document.getElementById('btnMeasure');
  const btnParcelDist = document.getElementById('btnParcelDist');
  const btnMoveBlock = document.getElementById('btnMoveBlock');
  const btnClear = document.getElementById('btnClear');
  const statsEl = document.getElementById('stats');

  const angleModeSel = document.getElementById('angleMode');
  const angleInput = document.getElementById('angle');
  const angleSlider = document.getElementById('angleSlider');
  const angleReadout = document.getElementById('angleReadout');

  function setAngleUI(v) {
    const a = Math.max(0, Math.min(179, Math.round(Number(v) || 0)));
    angleInput.value = String(a);
    if (angleSlider) angleSlider.value = String(a);
    if (angleReadout) angleReadout.textContent = String(a);
  }
  setAngleUI(angleInput.value);
  angleInput.addEventListener('input', () => setAngleUI(angleInput.value));
  if (angleSlider) angleSlider.addEventListener('input', () => setAngleUI(angleSlider.value));

  let measuring = false;
  let parcelDistMode = false;
  let moveBlockMode = false;

  let lastGeoJSON = null;
  let currentProjDef = null;
  let currentParcelsXY = [];
  let moveHandle = null;
  let selectedParcelIds = [];

  function enableDownloads() { btnGeo.disabled = false; btnShp.disabled = false; }
  function disableDownloads() { btnGeo.disabled = true; btnShp.disabled = true; }

  function fmt(x) { return (Math.round(x * 100) / 100).toLocaleString('es-ES'); }

  function showStats(html) {
    if (!html) { statsEl.style.display = 'none'; statsEl.innerHTML = ''; return; }
    statsEl.style.display = 'block';
    statsEl.innerHTML = html;
  }

  function layerToSinglePolygonGeoJSON(layer) {
    const gj = layer.toGeoJSON();
    if (!gj || !gj.geometry) throw new Error("No hay geometría.");
    if (gj.geometry.type !== "Polygon") throw new Error("Este demo espera un Polygon (no MultiPolygon).");
    const outer = gj.geometry.coordinates[0];
    if (!outer || outer.length < 4) throw new Error("Polígono inválido.");
    return gj;
  }

  function clearDerived() {
    parcelsGroup.clearLayers();
    insetLayer.clearLayers();
    measureGroup.clearLayers();
    parcelDistGroup.clearLayers();
    selectedParcelIds = [];
    currentParcelsXY = [];
    lastGeoJSON = null;
    currentProjDef = null;
    disableDownloads();
    showStats(null);
    if (moveHandle) { map.removeLayer(moveHandle); moveHandle = null; }
  }

  function clearAll() {
    if (inputLayer) { map.removeLayer(inputLayer); inputLayer = null; }
    clearDerived();
    if (measuring) toggleMeasure(false);
    if (parcelDistMode) toggleParcelDist(false);
    if (moveBlockMode) toggleMoveBlock(false);
  }

  btnClear.addEventListener('click', clearAll);

  // --- Measurement tool ---
  function computePolylineLengthMeters(latlngs) {
    let d = 0;
    for (let i = 0; i < latlngs.length - 1; i++) d += map.distance(latlngs[i], latlngs[i+1]);
    return d;
  }

  function toggleMeasure(forceState) {
    const next = (typeof forceState === 'boolean') ? forceState : !measuring;
    measuring = next;

    if (measuring) {
      btnMeasure.textContent = "Salir de medición";
      btnMeasure.classList.add('danger');
      map.pm.enableDraw('Line', { snappable: false, finishOn: 'dblclick' });
    } else {
      btnMeasure.textContent = "Medir distancia";
      btnMeasure.classList.remove('danger');
      map.pm.disableDraw('Line');
    }
  }
  btnMeasure.addEventListener('click', () => toggleMeasure());

  // --- Parcel distance mode ---
  function toggleParcelDist(forceState) {
    const next = (typeof forceState === 'boolean') ? forceState : !parcelDistMode;
    parcelDistMode = next;
    selectedParcelIds = [];
    parcelDistGroup.clearLayers();

    if (parcelDistMode) {
      btnParcelDist.textContent = "Salir (dist. parcelas)";
      btnParcelDist.classList.add('danger');
    } else {
      btnParcelDist.textContent = "Distancia entre parcelas";
      btnParcelDist.classList.remove('danger');
    }
  }
  btnParcelDist.addEventListener('click', () => toggleParcelDist());

  // --- Move block mode ---
  function toggleMoveBlock(forceState) {
    const next = (typeof forceState === 'boolean') ? forceState : !moveBlockMode;
    moveBlockMode = next;

    if (moveBlockMode) {
      btnMoveBlock.textContent = "Desactivar mover bloque";
      btnMoveBlock.classList.add('danger');
      createOrUpdateMoveHandle();
    } else {
      btnMoveBlock.textContent = "Mover bloque de parcelas";
      btnMoveBlock.classList.remove('danger');
      if (moveHandle) { map.removeLayer(moveHandle); moveHandle = null; }
    }
  }
  btnMoveBlock.addEventListener('click', () => toggleMoveBlock());

  function createOrUpdateMoveHandle() {
    if (!currentProjDef || currentParcelsXY.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of currentParcelsXY) {
      for (const ring of p.poly) {
        for (const [x,y] of ring) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const ll = proj4(currentProjDef, 'EPSG:4326', [cx, cy]);
    const latlng = L.latLng(ll[1], ll[0]);

    if (moveHandle) map.removeLayer(moveHandle);

    moveHandle = L.marker(latlng, { draggable: true, title: "Arrastra para mover el bloque" }).addTo(map);
    moveHandle.bindTooltip("Mover bloque", { permanent: true, direction: 'top', offset: [0, -10] }).openTooltip();

    let lastXY = [cx, cy];
    moveHandle.on('dragstart', () => {
      const ll0 = moveHandle.getLatLng();
      lastXY = proj4('EPSG:4326', currentProjDef, [ll0.lng, ll0.lat]);
    });

    moveHandle.on('drag', () => {
      const ll1 = moveHandle.getLatLng();
      const nowXY = proj4('EPSG:4326', currentProjDef, [ll1.lng, ll1.lat]);
      const dx = nowXY[0] - lastXY[0];
      const dy = nowXY[1] - lastXY[1];
      lastXY = nowXY;

      for (const p of currentParcelsXY) {
        p.poly = p.poly.map(ring => ring.map(([x,y]) => [x + dx, y + dy]));
      }

      renderParcelsFromXY();
      parcelDistGroup.clearLayers();
      selectedParcelIds = [];
    });

    moveHandle.on('dragend', () => rebuildLastGeoJSONFromXY());
  }

  function renderParcelsFromXY() {
    if (!currentProjDef) return;
    parcelsGroup.clearLayers();

    currentParcelsXY.forEach((p, idx) => {
      const ringsLonLat = p.poly.map(r => SmartGeometry.unprojectRing(SmartGeometry.closeRing(r), currentProjDef));
      const latlngRings = ringsLonLat.map(r => r.map(([lon,lat]) => [lat,lon]));
      const layer = L.polygon(latlngRings, { weight: 1, fillOpacity: 0.25 });
      layer._parcelId = idx;
      layer.addTo(parcelsGroup);

      layer.on('click', () => {
        if (!parcelDistMode) return;
        onParcelClicked(layer._parcelId);
      });
    });
  }

  function rebuildLastGeoJSONFromXY() {
    if (!currentProjDef) return;
    const gap = Number(document.getElementById('gap').value);
    const setback = Number(document.getElementById('setback').value);
    const w = Number(document.getElementById('w').value);
    const h = Number(document.getElementById('h').value);
    const chosenAngle = Number(document.getElementById('angle').value);

    const metaProps = {
      gap_m: Math.round(gap * 100) / 100,
      setback_m: Math.round(setback * 100) / 100,
      angle_deg: Math.round(chosenAngle * 100) / 100,
      w_m: Math.round(w * 100) / 100,
      h_m: Math.round(h * 100) / 100
    };
    lastGeoJSON = SmartExport.parcelsToGeoJSON(currentParcelsXY, currentProjDef, metaProps);
  }

  function onParcelClicked(parcelId) {
    if (!currentProjDef || parcelId == null) return;

    if (!selectedParcelIds.includes(parcelId)) selectedParcelIds.push(parcelId);
    if (selectedParcelIds.length > 2) selectedParcelIds = [selectedParcelIds[selectedParcelIds.length - 1]];
    if (selectedParcelIds.length < 2) return;

    const a = currentParcelsXY[selectedParcelIds[0]];
    const b = currentParcelsXY[selectedParcelIds[1]];
    if (!a || !b) return;

    const reader = new jsts.io.GeoJSONReader();
    const geomA = reader.read({ type:"Polygon", coordinates: a.poly.map(r => SmartGeometry.closeRing(r)) });
    const geomB = reader.read({ type:"Polygon", coordinates: b.poly.map(r => SmartGeometry.closeRing(r)) });

    const distOp = new jsts.operation.distance.DistanceOp(geomA, geomB);
    const pts = distOp.nearestPoints();
    const p1 = pts[0], p2 = pts[1];
    const dist = geomA.distance(geomB);

    parcelDistGroup.clearLayers();
    const ll1 = proj4(currentProjDef, 'EPSG:4326', [p1.x, p1.y]);
    const ll2 = proj4(currentProjDef, 'EPSG:4326', [p2.x, p2.y]);

    const line = L.polyline([[ll1[1], ll1[0]], [ll2[1], ll2[0]]], { weight: 2, dashArray: '4,6' }).addTo(parcelDistGroup);
    const label = (dist >= 1000) ? `${fmt(dist/1000)} km` : `${fmt(dist)} m`;
    line.bindTooltip(`Distancia: ${label}`, { permanent: true, direction: 'top' }).openTooltip();
  }

  // --- Create events ---
  map.on('pm:create', (e) => {
    const shape = e.shape;
    const layer = e.layer;

    if (shape === 'Line' && measuring) {
      measureGroup.addLayer(layer);
      const latlngs = layer.getLatLngs();
      const len = computePolylineLengthMeters(latlngs);
      const label = (len >= 1000) ? `${fmt(len/1000)} km` : `${fmt(len)} m`;
      layer.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] }).openTooltip();
      return;
    }

    if (shape === 'Polygon') {
      if (inputLayer) map.removeLayer(inputLayer);
      inputLayer = layer;
      inputLayer.addTo(map);
      clearDerived();
    }
  });

  // --- Generate parcels ---
  btnGen.addEventListener('click', () => {
    try {
      if (!inputLayer) throw new Error("Dibuja primero un polígono.");
      const gj = layerToSinglePolygonGeoJSON(inputLayer);

      const w = Number(document.getElementById('w').value);
      const h = Number(document.getElementById('h').value);
      const gap = Number(document.getElementById('gap').value);
      const setback = Number(document.getElementById('setback').value);
      const angleManual = Number(document.getElementById('angle').value);
      const autoStep = Number(document.getElementById('autoStep').value);
      const minCount = Number(document.getElementById('minCount').value);
      const maxCount = Number(document.getElementById('maxCount').value);
      const minArea = Number(document.getElementById('minArea').value);

      if (!(w > 0 && h > 0)) throw new Error("Ancho y alto deben ser > 0.");
      if (gap < 0) throw new Error("La separación no puede ser negativa.");
      if (setback < 0) throw new Error("El retranqueo no puede ser negativo.");
      if (minArea < 0) throw new Error("Área mínima no puede ser negativa.");
      if (minCount < 0 || maxCount < 0) throw new Error("Mín/Máx de parcelas no puede ser negativo.");
      if (maxCount > 0 && minCount > 0 && maxCount < minCount) throw new Error("Máx parcelas no puede ser menor que mín parcelas.");

      const [lonC, latC] = SmartGeometry.centroidLonLatOfPolygon(gj);
      const utm = SmartGeometry.utmProjForLonLat(lonC, latC);
      currentProjDef = utm.proj;

      const ringLonLat = gj.geometry.coordinates[0];
      const ringXY = SmartGeometry.projectRing(ringLonLat, currentProjDef);

      const insetXY = SmartGeometry.bufferInsetRingXY(ringXY, setback);
      insetLayer.clearLayers();
      if (!insetXY) throw new Error("El retranqueo deja el polígono sin área. Reduce el retranqueo.");

      const insetLonLat = SmartGeometry.unprojectRing(insetXY, currentProjDef);
      insetLayer.addData({ type:"Feature", properties:{}, geometry:{ type:"Polygon", coordinates:[insetLonLat] } });

      const mode = angleModeSel.value;
      let chosenAngle = angleManual;
      let parcels = [];
      let sumArea = 0;

      if (mode === 'manual') {
        const r = SmartGeometry.generateParcelsForAngle(insetXY, w, h, gap, minArea, angleManual);
        parcels = r.parcels; sumArea = r.sumArea; chosenAngle = angleManual;
        if ((minCount > 0 && parcels.length < minCount) || (maxCount > 0 && parcels.length > maxCount)) {
          throw new Error(`Resultado fuera de rango: ${parcels.length} parcelas (mín=${minCount||0}, máx=${maxCount||"∞"}).`);
        }
      } else {
        const best = SmartGeometry.autoOrient(insetXY, w, h, gap, minArea, autoStep, minCount, maxCount);
        if (!best.satisfied) throw new Error("No se encontró una orientación que cumpla el rango de nº de parcelas.");
        parcels = best.parcels; sumArea = best.sumArea; chosenAngle = best.angle;
        setAngleUI(chosenAngle);
      }

      currentParcelsXY = parcels;
      renderParcelsFromXY();

      const metaProps = {
        gap_m: Math.round(gap * 100) / 100,
        setback_m: Math.round(setback * 100) / 100,
        angle_deg: Math.round(chosenAngle * 100) / 100,
        w_m: Math.round(w * 100) / 100,
        h_m: Math.round(h * 100) / 100
      };

      lastGeoJSON = SmartExport.parcelsToGeoJSON(currentParcelsXY, currentProjDef, metaProps);
      if (lastGeoJSON.features.length) enableDownloads(); else disableDownloads();

      // Fit
      const group = L.featureGroup([inputLayer, parcelsGroup, insetLayer]);
      try { map.fitBounds(group.getBounds(), { padding: [20,20] }); } catch {}

      if (moveBlockMode) createOrUpdateMoveHandle();
      else if (moveHandle) { map.removeLayer(moveHandle); moveHandle = null; }

      parcelDistGroup.clearLayers();
      selectedParcelIds = [];

      const st = SmartExport.statsFromGeoJSON(lastGeoJSON);
      showStats(`<b>Parcelas</b>: ${st.count} · <b>Área total</b>: ${fmt(st.sum_m2)} m²`);

    } catch (err) {
      alert(err?.message || String(err));
    }
  });

  btnGeo.addEventListener('click', () => { if (lastGeoJSON) SmartExport.downloadGeoJSON(lastGeoJSON); });
  btnShp.addEventListener('click', () => { if (lastGeoJSON) SmartExport.downloadSHP(lastGeoJSON); });

})();