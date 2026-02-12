(function(){
  function createBasemaps() {
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap'
    });

    const esri = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, attribution: 'Tiles &copy; Esri' }
    );

    return { osm, esri };
  }

  function wireBasemapUI(map, { osm, esri }) {
    let customXYZ = null;

    const basemapSel = document.getElementById('basemap');
    const customRow = document.getElementById('customRow');
    const customUrl = document.getElementById('customUrl');
    const btnAdd = document.getElementById('btnAddCustom');

    function removeAll() {
      [osm, esri, customXYZ].forEach(l => { if (l && map.hasLayer(l)) map.removeLayer(l); });
    }

    basemapSel.addEventListener('change', () => {
      const v = basemapSel.value;
      customRow.style.display = (v === 'custom') ? 'block' : 'none';
      removeAll();
      if (v === 'osm') osm.addTo(map);
      else if (v === 'esri') esri.addTo(map);
      else { osm.addTo(map); } // fallback hasta aplicar custom
    });

    btnAdd.addEventListener('click', () => {
      const url = (customUrl.value || '').trim();
      if (!url.includes('{z}') || !url.includes('{x}') || !url.includes('{y}')) {
        alert("La URL debe contener {z}/{x}/{y}.");
        return;
      }
      removeAll();
      customXYZ = L.tileLayer(url, { maxZoom: 22, attribution: 'XYZ personalizado' });
      customXYZ.addTo(map);
    });

    // default
    osm.addTo(map);
  }

  window.SmartBasemaps = { createBasemaps, wireBasemapUI };
})();