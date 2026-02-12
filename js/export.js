(function(){
  function parcelsToGeoJSON(parcelsXY, projDef, metaProps) {
    const features = parcelsXY.map((p, idx) => {
      const ringsLonLat = p.poly.map(r => SmartGeometry.unprojectRing(SmartGeometry.closeRing(r), projDef));
      return {
        type: "Feature",
        properties: {
          id: idx + 1,
          area_m2: Math.round(p.area_m2 * 100) / 100,
          area_ha: Math.round((p.area_m2 / 10000) * 10000) / 10000,
          ...metaProps
        },
        geometry: { type: "Polygon", coordinates: ringsLonLat }
      };
    });
    return { type: "FeatureCollection", features };
  }

  function downloadGeoJSON(fc, filename="parcelas.geojson") {
    const blob = new Blob([JSON.stringify(fc, null, 2)], {type:"application/geo+json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSHP(fc) {
    shpwrite.download(fc, { folder: "parcelas", types: { polygon: "parcelas" } });
  }

  function statsFromGeoJSON(fc) {
    const areas = fc.features.map(f => Number(f.properties.area_m2)).filter(x => Number.isFinite(x));
    areas.sort((a,b)=>a-b);
    const sum = areas.reduce((a,b)=>a+b,0);
    return {
      count: areas.length,
      sum_m2: sum,
      sum_ha: sum / 10000,
      avg_m2: areas.length ? sum / areas.length : 0,
      min_m2: areas.length ? areas[0] : 0,
      max_m2: areas.length ? areas[areas.length - 1] : 0
    };
  }

  window.SmartExport = { parcelsToGeoJSON, downloadGeoJSON, downloadSHP, statsFromGeoJSON };
})();