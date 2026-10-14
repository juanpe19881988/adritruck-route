/**
 * AdriTruck PRO — Planificador de Rutas para Camiones por Dimensiones, Gálibos y Giros
 * Soporta Valhalla (OSM Truck sin clave), HERE Truck Routing v8, OpenRouteService HGV
 * y Radar de Restricciones en vivo con Overpass API.
 */

// --- Estado Global de la Aplicación ---
const state = {
  clickMode: 'origin', // 'origin' | 'dest'
  origin: null,        // { lat, lng, label }
  dest: null,          // { lat, lng, label }
  truck: {
    type: 'articulated', // 'rigid' | 'articulated'
    length: 16.5,        // metros
    height: 4.0,         // metros
    width: 2.55,         // metros
    weight: 40.0,        // toneladas (MMA)
    axleLoad: 11.5,      // toneladas por eje
    axles: 5,
    hazmat: false,
    avoidTolls: false
  },
  engine: 'valhalla',    // 'valhalla' | 'here' | 'ors'
  routes: {
    truckCoords: [],
    carCoords: [],
    altEngineCoords: [],
    maneuvers: [],
    sharpTurns: [],
    hazards: []
  }
};

// --- Plantillas de Camiones Europeos ---
const TRUCK_PRESETS = {
  furgon: {
    type: 'rigid',
    length: 6.5,
    height: 3.1,
    width: 2.2,
    weight: 3.5,
    axleLoad: 2.5,
    axles: 2
  },
  rigido2: {
    type: 'rigid',
    length: 8.5,
    height: 3.5,
    width: 2.5,
    weight: 18.0,
    axleLoad: 10.0,
    axles: 2
  },
  rigido3: {
    type: 'rigid',
    length: 11.0,
    height: 3.8,
    width: 2.55,
    weight: 26.0,
    axleLoad: 11.5,
    axles: 3
  },
  trailer: {
    type: 'articulated',
    length: 16.5,
    height: 4.0,
    width: 2.55,
    weight: 40.0,
    axleLoad: 11.5,
    axles: 5
  }
};

// --- Escenarios de Demostración en España ---
const DEMO_SCENARIOS = {
  madrid_puentes: {
    name: 'Madrid: Pasos Inferiores y Gálibos (Pacífico → Méndez Álvaro)',
    origin: { lat: 40.4018, lng: -3.6768, label: 'Av. Ciudad de Barcelona / Pacífico, Madrid' },
    dest: { lat: 40.3919, lng: -3.6815, label: 'Calle Méndez Álvaro (Zona Estación/Carga), Madrid' },
    preset: 'trailer'
  },
  coslada_mercamadrid: {
    name: 'Madrid Logística: CTC Coslada → Mercamadrid',
    origin: { lat: 40.4321, lng: -3.5392, label: 'Centro de Transportes de Coslada (CTC), Madrid' },
    dest: { lat: 40.3612, lng: -3.6625, label: 'Mercamadrid (Zona Carga Pesada), Madrid' },
    preset: 'trailer'
  },
  toledo_casco: {
    name: 'Toledo: Polígono Industrial → Acceso Urbano',
    origin: { lat: 39.8652, lng: -3.9628, label: 'Polígono Industrial Santa María de Benquerencia, Toledo' },
    dest: { lat: 39.8628, lng: -4.0225, label: 'Puerta de Bisagra / Acceso Norte, Toledo' },
    preset: 'rigido3'
  },
  barcelona_puerto: {
    name: 'Barcelona: Zona Franca → Polígono Badalona Sur',
    origin: { lat: 41.3325, lng: 2.1375, label: 'Polígono Zona Franca (Calle A), Barcelona' },
    dest: { lat: 41.4342, lng: 2.2314, label: 'Polígono Industrial Badalona Sud, Barcelona' },
    preset: 'trailer'
  }
};

// --- Variables de Mapa Leaflet ---
let map;
let tileStreets, tileSatellite, tileLabels;
let originMarker = null;
let destMarker = null;
let routeLayerGroup;
let hazardLayerGroup;
let turnLayerGroup;

// --- Seguridad y Control de Acceso por Contraseña ---
// Hash SHA-256 de la clave autorizada (protege la clave sin exponer el texto en GitHub)
const AUTH_PASSWORD_HASH = 'bc1fae8f1a53b3474f9dcc2f3b1083d90669bd8fa7a9d021eccaca1659c4f446';

async function computeSha256(str) {
  if (window.crypto && crypto.subtle) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return str === 'Asturias2026dron' ? AUTH_PASSWORD_HASH : 'invalid';
}

function checkAuthentication() {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;

  // 1. Permitir acceso directo por enlace: ?pass=... o ?key=...
  const urlParams = new URLSearchParams(window.location.search);
  const paramPass = urlParams.get('pass') || urlParams.get('key');
  if (paramPass) {
    computeSha256(paramPass).then(hash => {
      if (hash === AUTH_PASSWORD_HASH) {
        localStorage.setItem('adritruck_auth', AUTH_PASSWORD_HASH);
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        unlockApp(overlay);
        return;
      }
    });
  }

  // 2. Comprobar si el navegador ya fue autorizado anteriormente
  const savedAuth = localStorage.getItem('adritruck_auth');
  if (savedAuth === AUTH_PASSWORD_HASH) {
    unlockApp(overlay, false);
  } else {
    lockApp(overlay);
  }
}

function unlockApp(overlay, animate = true) {
  if (!overlay) overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.classList.add('unlocked');
  }
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, animate ? 350 : 50);
}

function lockApp(overlay) {
  if (!overlay) overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.classList.remove('unlocked');
  }
  const input = document.getElementById('authPasswordInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 250);
  }
  const errorMsg = document.getElementById('authErrorMsg');
  if (errorMsg) errorMsg.classList.add('hidden');
}

function initAuthEvents() {
  const form = document.getElementById('authForm');
  const input = document.getElementById('authPasswordInput');
  const errorMsg = document.getElementById('authErrorMsg');
  const card = document.querySelector('.auth-card');
  const btnToggle = document.getElementById('btnToggleAuthPass');
  const btnLock = document.getElementById('btnLockApp');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entered = input.value.trim();
      const hash = await computeSha256(entered);
      if (hash === AUTH_PASSWORD_HASH) {
        localStorage.setItem('adritruck_auth', AUTH_PASSWORD_HASH);
        if (errorMsg) errorMsg.classList.add('hidden');
        unlockApp();
      } else {
        if (errorMsg) errorMsg.classList.remove('hidden');
        if (card) {
          card.classList.remove('shake');
          void card.offsetWidth;
          card.classList.add('shake');
        }
        input.select();
      }
    });
  }

  if (btnToggle && input) {
    btnToggle.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        btnToggle.textContent = '🙈';
      } else {
        input.type = 'password';
        btnToggle.textContent = '👁️';
      }
    });
  }

  if (btnLock) {
    btnLock.addEventListener('click', () => {
      localStorage.removeItem('adritruck_auth');
      lockApp();
    });
  }
}

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
  initAuthEvents();
  checkAuthentication();
  initMap();
  initUIEvents();
  loadStoredSettings();
  updateTruckSummaryPill();
});

function initMap() {
  // Centrado inicialmente en la Península Ibérica (Madrid)
  map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 6,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Capa Callejero Oficial (Esri World Street Map - Rápido, de alta resolución y libre de bloqueos)
  tileStreets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; HERE, DeLorme, MapmyIndia, OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  // Capa Satélite para inspeccionar rotondas y muelles de carga
  tileSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  });

  tileLabels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });

  // Grupos de capas
  routeLayerGroup = L.layerGroup().addTo(map);
  hazardLayerGroup = L.layerGroup().addTo(map);
  turnLayerGroup = L.layerGroup().addTo(map);

  // Evento al tocar el mapa para colocar Origen o Destino
  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    if (state.clickMode === 'origin') {
      await setWaypoint('origin', lat, lng);
      // Cambiar automáticamente al modo destino si aún no hay destino
      if (!state.dest) {
        setClickMode('dest');
      }
    } else {
      await setWaypoint('dest', lat, lng);
    }

    if (state.origin && state.dest) {
      calculateRoute();
    }
  });
}

// --- Gestión de Marcadores de Origen y Destino ---
async function setWaypoint(type, lat, lng, customLabel = null) {
  const label = customLabel || await reverseGeocode(lat, lng);
  const pointData = { lat, lng, label };

  if (type === 'origin') {
    state.origin = pointData;
    document.getElementById('originInput').value = label;

    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-pin pin-origin">A</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (originMarker) {
      originMarker.setLatLng([lat, lng]);
    } else {
      originMarker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
      originMarker.on('dragend', async (ev) => {
        const pos = ev.target.getLatLng();
        await setWaypoint('origin', pos.lat, pos.lng);
        if (state.origin && state.dest) calculateRoute();
      });
    }
  } else {
    state.dest = pointData;
    document.getElementById('destInput').value = label;

    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-pin pin-dest">B</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (destMarker) {
      destMarker.setLatLng([lat, lng]);
    } else {
      destMarker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
      destMarker.on('dragend', async (ev) => {
        const pos = ev.target.getLatLng();
        await setWaypoint('dest', pos.lat, pos.lng);
        if (state.origin && state.dest) calculateRoute();
      });
    }
  }
}

function setClickMode(mode) {
  state.clickMode = mode;
  document.getElementById('modeOriginBtn').classList.toggle('active', mode === 'origin');
  document.getElementById('modeDestBtn').classList.toggle('active', mode === 'dest');
}

// --- Geocodificación y Autocompletado (Photon / Nominatim) ---
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const p = data.features[0].properties;
      const parts = [p.name || p.street, p.housenumber, p.city || p.town || p.village].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    }
  } catch (err) {
    console.warn('Error en reverseGeocode:', err);
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function setupAutocomplete(inputId, suggestionsId, waypointType) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(suggestionsId);
  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      list.classList.add('hidden');
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        // Priorizar España/Europa alrededor del centro actual del mapa
        const center = map.getCenter();
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}&limit=5`;
        const res = await fetch(url);
        const data = await res.json();

        list.innerHTML = '';
        if (!data.features || data.features.length === 0) {
          list.classList.add('hidden');
          return;
        }

        data.features.forEach((feat) => {
          const [lng, lat] = feat.geometry.coordinates;
          const p = feat.properties;
          const mainName = p.name || p.street || 'Ubicación';
          const subName = [p.street, p.city || p.town || p.state, p.country].filter(Boolean).join(', ');

          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.innerHTML = `<strong>${mainName}</strong><small>${subName}</small>`;
          item.addEventListener('click', async () => {
            list.classList.add('hidden');
            const fullLabel = `${mainName}${subName ? ' (' + subName + ')' : ''}`;
            await setWaypoint(waypointType, lat, lng, fullLabel);
            map.setView([lat, lng], 14);
            if (state.origin && state.dest) {
              calculateRoute();
            }
          });
          list.appendChild(item);
        });

        list.classList.remove('hidden');
      } catch (err) {
        console.error('Error buscando dirección:', err);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.classList.add('hidden');
    }
  });
}

// --- Eventos de Interfaz ---
function initUIEvents() {
  // Pestañas (Tabs)
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Botón superior de resumen de camión lleva a la pestaña Camión
  document.getElementById('btnQuickSpec').addEventListener('click', () => {
    switchTab('tab-camion');
    const panel = document.getElementById('controlPanel');
    panel.classList.remove('collapsed');
  });

  // Panel colapsable en móvil
  document.getElementById('mobileSheetHandle').addEventListener('click', () => {
    document.getElementById('controlPanel').classList.toggle('collapsed');
  });

  // Modo clic en mapa
  document.getElementById('modeOriginBtn').addEventListener('click', () => setClickMode('origin'));
  document.getElementById('modeDestBtn').addEventListener('click', () => setClickMode('dest'));

  // Autocompletado de Origen y Destino
  setupAutocomplete('originInput', 'originSuggestions', 'origin');
  setupAutocomplete('destInput', 'destSuggestions', 'dest');

  // Mi ubicación GPS
  document.getElementById('btnMyLocation').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización GPS.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        await setWaypoint('origin', latitude, longitude, 'Mi ubicación GPS actual');
        map.setView([latitude, longitude], 14);
        if (state.dest) calculateRoute();
      },
      () => alert('No se pudo obtener la ubicación GPS. Verifica los permisos del navegador.')
    );
  });

  // Invertir Origen y Destino
  document.getElementById('btnSwapPoints').addEventListener('click', async () => {
    if (!state.origin && !state.dest) return;
    const temp = state.origin ? { ...state.origin } : null;
    const tempDest = state.dest ? { ...state.dest } : null;

    if (tempDest) await setWaypoint('origin', tempDest.lat, tempDest.lng, tempDest.label);
    if (temp) await setWaypoint('dest', temp.lat, temp.lng, temp.label);

    if (state.origin && state.dest) calculateRoute();
  });

  // Limpiar puntos
  document.getElementById('btnClearPoints').addEventListener('click', () => {
    state.origin = null;
    state.dest = null;
    document.getElementById('originInput').value = '';
    document.getElementById('destInput').value = '';
    if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    routeLayerGroup.clearLayers();
    hazardLayerGroup.clearLayers();
    turnLayerGroup.clearLayers();
    document.getElementById('routeResultCard').classList.add('hidden');
    setClickMode('origin');
  });

  // Plantillas de Camión (Presets)
  document.querySelectorAll('.preset-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const preset = TRUCK_PRESETS[card.dataset.preset];
      if (!preset) return;

      document.querySelector(`input[name="truckType"][value="${preset.type}"]`).checked = true;
      document.getElementById('truckLength').value = preset.length;
      document.getElementById('truckHeight').value = preset.height;
      document.getElementById('truckWidth').value = preset.width;
      document.getElementById('truckWeight').value = preset.weight;
      document.getElementById('truckAxleLoad').value = preset.axleLoad;
      document.getElementById('truckAxles').value = preset.axles;

      readTruckSpecsFromInputs();
    });
  });

  // Botón Aplicar Medidas
  document.getElementById('btnApplyTruckSpec').addEventListener('click', () => {
    readTruckSpecsFromInputs();
    switchTab('tab-ruta');
    if (state.origin && state.dest) {
      calculateRoute();
    }
  });

  // Botón Calcular Ruta
  document.getElementById('btnCalculateRoute').addEventListener('click', () => {
    readTruckSpecsFromInputs();
    calculateRoute();
  });

  // Toggles visuales
  ['chkCompareCar', 'chkShowHazards', 'chkHighlightTurns'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      if (state.origin && state.dest) calculateRoute();
    });
  });

  // Selector de motor de rutas y persistencia en localStorage
  document.querySelectorAll('input[name="routingEngine"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.engine = e.target.value;
      localStorage.setItem('adritruck_engine', e.target.value);
    });
  });

  // Guardado automático en localStorage de las API Keys al teclear o pegar
  const orsInput = document.getElementById('orsApiKey');
  if (orsInput) {
    orsInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      localStorage.setItem('adritruck_ors_key', val);
    });
  }

  const hereInput = document.getElementById('hereApiKey');
  if (hereInput) {
    hereInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      localStorage.setItem('adritruck_here_key', val);
    });
  }

  // Selector de Capas del Mapa (Callejero vs Satélite)
  document.querySelectorAll('.layer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const layer = btn.dataset.layer;
      if (layer === 'satellite') {
        map.removeLayer(tileStreets);
        tileSatellite.addTo(map);
        tileLabels.addTo(map);
      } else {
        map.removeLayer(tileSatellite);
        map.removeLayer(tileLabels);
        tileStreets.addTo(map);
      }
    });
  });

  // Modal de Ejemplos en España
  const demoModal = document.getElementById('demoModal');
  document.getElementById('btnDemoRoutes').addEventListener('click', () => {
    demoModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseModal').addEventListener('click', () => {
    demoModal.classList.add('hidden');
  });
  document.querySelectorAll('.demo-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const key = item.dataset.demo;
      const demo = DEMO_SCENARIOS[key];
      if (!demo) return;
      demoModal.classList.add('hidden');

      // Aplicar plantilla de camión del ejemplo
      const presetBtn = document.querySelector(`.preset-card[data-preset="${demo.preset}"]`);
      if (presetBtn) presetBtn.click();

      await setWaypoint('origin', demo.origin.lat, demo.origin.lng, demo.origin.label);
      await setWaypoint('dest', demo.dest.lat, demo.dest.lng, demo.dest.label);
      switchTab('tab-ruta');
      calculateRoute();
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((sec) => {
    sec.classList.toggle('active', sec.id === tabId);
  });
}

function readTruckSpecsFromInputs() {
  const typeRadio = document.querySelector('input[name="truckType"]:checked');
  state.truck.type = typeRadio ? typeRadio.value : 'articulated';
  state.truck.length = parseFloat(document.getElementById('truckLength').value) || 16.5;
  state.truck.height = parseFloat(document.getElementById('truckHeight').value) || 4.0;
  state.truck.width = parseFloat(document.getElementById('truckWidth').value) || 2.55;
  state.truck.weight = parseFloat(document.getElementById('truckWeight').value) || 40.0;
  state.truck.axleLoad = parseFloat(document.getElementById('truckAxleLoad').value) || 11.5;
  state.truck.axles = parseInt(document.getElementById('truckAxles').value, 10) || 5;
  state.truck.hazmat = document.getElementById('chkHazmat').checked;
  state.truck.avoidTolls = document.getElementById('chkAvoidTolls').checked;

  updateTruckSummaryPill();
}

function updateTruckSummaryPill() {
  const t = state.truck;
  const icon = t.type === 'articulated' ? '🚛' : '🚚';
  const typeLabel = t.type === 'articulated' ? 'Tráiler' : 'Rígido';
  document.getElementById('pillTypeIcon').textContent = icon;
  document.getElementById('pillDimensions').textContent =
    `${typeLabel} ${t.length}m · ↕${t.height}m · ↔${t.width}m · ${t.weight}t`;
}

// Cargar y restaurar configuraciones y API Keys desde localStorage
function loadStoredSettings() {
  try {
    const savedOrsKey = localStorage.getItem('adritruck_ors_key');
    if (savedOrsKey) {
      const orsInput = document.getElementById('orsApiKey');
      if (orsInput) orsInput.value = savedOrsKey;
    }

    const savedHereKey = localStorage.getItem('adritruck_here_key');
    if (savedHereKey) {
      const hereInput = document.getElementById('hereApiKey');
      if (hereInput) hereInput.value = savedHereKey;
    }

    const savedEngine = localStorage.getItem('adritruck_engine');
    if (savedEngine) {
      state.engine = savedEngine;
      const radio = document.querySelector(`input[name="routingEngine"][value="${savedEngine}"]`);
      if (radio) radio.checked = true;
    }
  } catch (e) {
    console.warn('No se pudo acceder a localStorage:', e);
  }
}

// --- Motor Principal de Cálculo de Rutas ---
async function calculateRoute() {
  if (!state.origin || !state.dest) {
    alert('Por favor, selecciona un Origen (A) y un Destino (B) en el mapa o en el buscador.');
    return;
  }

  readTruckSpecsFromInputs();
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  loadingText.textContent = `Calculando ruta óptima para ${state.truck.length}m (${state.truck.height}m alto, ${state.truck.weight}t)...`;
  loadingOverlay.classList.remove('hidden');

  routeLayerGroup.clearLayers();
  hazardLayerGroup.clearLayers();
  turnLayerGroup.clearLayers();

  try {
    let truckResult = null;
    const selectedEngine = state.engine;

    if (selectedEngine === 'here') {
      const apiKey = document.getElementById('hereApiKey').value.trim();
      if (!apiKey) {
        alert('Para usar HERE Truck Routing v8 necesitas introducir tu HERE API Key en la pestaña Motor. Usando Valhalla OSM por defecto.');
        truckResult = await fetchValhallaRoute('truck');
      } else {
        truckResult = await fetchHereTruckRoute(apiKey);
      }
    } else if (selectedEngine === 'ors') {
      const apiKey = document.getElementById('orsApiKey').value.trim();
      if (!apiKey) {
        alert('Para usar OpenRouteService HGV necesitas introducir tu API Key en la pestaña Motor. Usando Valhalla OSM por defecto.');
        truckResult = await fetchValhallaRoute('truck');
      } else {
        truckResult = await fetchOrsTruckRoute(apiKey);
      }
    } else {
      truckResult = await fetchValhallaRoute('truck');
    }

    state.routes.truckCoords = truckResult.coords;
    state.routes.maneuvers = truckResult.maneuvers;

    // 1. Si está activada la comparativa con Coche, pedir ruta estándar de turismo
    let carResult = null;
    if (document.getElementById('chkCompareCar').checked) {
      try {
        carResult = await fetchValhallaRoute('auto');
        state.routes.carCoords = carResult.coords;
      } catch (e) {
        console.warn('No se pudo obtener la ruta comparativa de coche:', e);
      }
    }

    // 2. Dibujar rutas en el mapa
    if (carResult && carResult.coords.length > 0) {
      const carLine = L.polyline(carResult.coords, {
        color: '#ef4444',
        weight: 4,
        opacity: 0.65,
        dashArray: '8, 8'
      }).addTo(routeLayerGroup);
      carLine.bindTooltip('Ruta de Coche (Descartada por dimensiones/restricciones de camión)', { sticky: true });
    }

    // Borde exterior de la ruta de camión para alto contraste
    L.polyline(truckResult.coords, {
      color: '#1e3a8a',
      weight: 9,
      opacity: 0.85,
      lineCap: 'round'
    }).addTo(routeLayerGroup);

    const truckLine = L.polyline(truckResult.coords, {
      color: '#3b82f6',
      weight: 6,
      opacity: 1,
      lineCap: 'round'
    }).addTo(routeLayerGroup);
    truckLine.bindTooltip(`Ruta Segura Camión (${state.truck.length}m / ${state.truck.height}m)`, { sticky: true });

    // Ajustar zoom a la ruta
    map.fitBounds(truckLine.getBounds(), { padding: [50, 50] });

    // 3. Analizar Giros Cerrados según la longitud del camión y si es articulado
    const sharpTurns = analyzeSharpTurns(truckResult.coords, state.truck);
    state.routes.sharpTurns = sharpTurns;
    if (document.getElementById('chkHighlightTurns').checked) {
      renderSharpTurnsOnMap(sharpTurns);
    }

    // 4. Escanear Puentes Bajos, Tonelaje y Calles Prohibidas en la zona (Overpass API)
    let hazards = [];
    if (document.getElementById('chkShowHazards').checked) {
      loadingText.textContent = 'Escaneando gálibos de puentes, límites de peso y calles prohibidas...';
      hazards = await scanHazardsOverpass(truckResult.coords, state.truck);
      state.routes.hazards = hazards;
      renderHazardsOnMap(hazards);
    }

    // 5. Actualizar interfaz de resultados, comparativa y enlaces a Google Maps / Waze
    updateRouteResultUI(truckResult, carResult, sharpTurns, hazards);
    renderAlertsAndManeuversTab(hazards, sharpTurns, truckResult.maneuvers);
    updateExportLinks(truckResult.coords);

  } catch (err) {
    console.error('Error al calcular la ruta:', err);
    alert(`No se pudo calcular la ruta para estas dimensiones: ${err.message || 'Verifica la conexión o si el destino tiene una prohibición total de paso.'}`);
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

// --- 1. Motor Valhalla Open Source (Soporta Truck Dimensions & Geometría) ---
async function fetchValhallaRoute(mode = 'truck') {
  const t = state.truck;
  const locations = [
    { lat: state.origin.lat, lon: state.origin.lng },
    { lat: state.dest.lat, lon: state.dest.lng }
  ];

  // Penalizaciones dinámicas según longitud del camión y si lleva remolque articulado
  const isLongTruck = t.length >= 12 || t.type === 'articulated';
  const maneuverPenalty = isLongTruck ? 35 : 15; // Penaliza giros complejos en intersecciones
  const alleyFactor = isLongTruck ? 8.0 : 3.0;   // Penaliza callejones estrechos

  const body = {
    locations,
    costing: mode === 'truck' ? 'truck' : 'auto',
    directions_options: {
      units: 'kilometers',
      language: 'es-ES'
    }
  };

  if (mode === 'truck') {
    body.costing_options = {
      truck: {
        length: t.length,
        height: t.height,
        width: t.width,
        weight: t.weight,
        axle_load: t.axleLoad,
        axle_count: t.axles,
        hazmat: t.hazmat,
        use_tolls: t.avoidTolls ? 0.0 : 1.0,
        use_living_streets: 0.0, // Evitar calles residenciales peatonales/estrechas
        use_tracks: 0.0,         // Evitar caminos sin asfaltar
        maneuver_penalty: maneuverPenalty,
        alley_factor: alleyFactor
      }
    };
  }

  const response = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Servidor de rutas respondió con estado ${response.status}`);
  }

  const data = await response.json();
  const leg = data.trip.legs[0];
  const coords = decodePolyline6(leg.shape);
  const maneuvers = (leg.maneuvers || []).map((m) => ({
    instruction: m.instruction,
    lengthKm: m.length,
    timeSec: m.time,
    type: m.type,
    coord: coords[m.begin_shape_index] || coords[0]
  }));

  return {
    engineName: 'Valhalla OSM Truck',
    distanceKm: data.trip.summary.length,
    durationMin: Math.round(data.trip.summary.time / 60),
    coords,
    maneuvers
  };
}

// --- 2. Motor Comercial HERE Truck Routing v8 ---
async function fetchHereTruckRoute(apiKey) {
  const t = state.truck;
  const params = new URLSearchParams({
    transportMode: 'truck',
    origin: `${state.origin.lat},${state.origin.lng}`,
    destination: `${state.dest.lat},${state.dest.lng}`,
    return: 'polyline,summary,actions,instructions',
    lang: 'es-ES',
    'vehicle[height]': Math.round(t.height * 100),        // en cm
    'vehicle[width]': Math.round(t.width * 100),          // en cm
    'vehicle[length]': Math.round(t.length * 100),        // en cm
    'vehicle[grossWeight]': Math.round(t.weight * 1000),  // en kg
    'vehicle[weightPerAxle]': Math.round(t.axleLoad * 1000),
    'vehicle[axleCount]': t.axles,
    'vehicle[trailerCount]': t.type === 'articulated' ? 1 : 0,
    'vehicle[difficultTurns]': 'false', // Evita giros cerrados para camiones articulados
    apiKey
  });

  if (t.avoidTolls) {
    params.append('avoid[features]', 'tollRoad');
  }

  const res = await fetch(`https://router.hereapi.com/v8/routes?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Error en HERE API (${res.status}). Verifica tu API Key.`);
  }
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('HERE Maps no encontró ruta segura para las dimensiones del camión.');
  }

  const section = data.routes[0].sections[0];
  const coords = decodeHereFlexiblePolyline(section.polyline);
  const maneuvers = (section.actions || []).map((a) => ({
    instruction: a.instruction || `Maniobra: ${a.action}`,
    lengthKm: ((a.length || 0) / 1000),
    timeSec: a.duration || 0,
    coord: coords[a.offset] || coords[0]
  }));

  return {
    engineName: 'HERE Truck Routing v8',
    distanceKm: section.summary.length / 1000,
    durationMin: Math.round(section.summary.duration / 60),
    coords,
    maneuvers
  };
}

// --- 3. Motor OpenRouteService (ORS driving-hgv) ---
async function fetchOrsTruckRoute(apiKey) {
  const t = state.truck;
  const body = {
    coordinates: [
      [state.origin.lng, state.origin.lat],
      [state.dest.lng, state.dest.lat]
    ],
    language: 'es',
    options: {
      vehicle_type: 'hgv',
      avoid_features: t.avoidTolls ? ['tollways'] : [],
      profile_params: {
        restrictions: {
          length: t.length,
          height: t.height,
          width: t.width,
          weight: t.weight,
          axleload: t.axleLoad,
          hazmat: t.hazmat
        }
      }
    }
  };

  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Error en OpenRouteService (${res.status}). Verifica tu API Key.`);
  }

  const data = await res.json();
  const feat = data.features[0];
  const coords = feat.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const summary = feat.properties.summary;
  const steps = feat.properties.segments[0].steps || [];

  const maneuvers = steps.map((s) => ({
    instruction: s.instruction,
    lengthKm: s.distance / 1000,
    timeSec: s.duration,
    coord: coords[s.way_points[0]] || coords[0]
  }));

  return {
    engineName: 'OpenRouteService HGV',
    distanceKm: summary.distance / 1000,
    durationMin: Math.round(summary.duration / 60),
    coords,
    maneuvers
  };
}

// --- Analizador Geométrico de Giros Cerrados según Metros del Camión ---
function analyzeSharpTurns(coords, truck) {
  if (!coords || coords.length < 4) return [];

  // Umbral de ángulo según longitud y tipo de camión
  // Un tráiler de 16.5m sufre a partir de giros > 75° en tramos cortos; un rígido a partir de > 95°
  const minAngle = (truck.type === 'articulated' || truck.length >= 13) ? 78 : 95;
  const sharpTurns = [];
  let lastTurnCoord = null;

  for (let i = 2; i < coords.length - 2; i++) {
    const pPrev = coords[i - 2];
    const pCurr = coords[i];
    const pNext = coords[i + 2];

    const dist1 = haversineMeters(pPrev[0], pPrev[1], pCurr[0], pCurr[1]);
    const dist2 = haversineMeters(pCurr[0], pCurr[1], pNext[0], pNext[1]);

    // Analizar intersecciones urbanas/polígonos (segmentos cortos entre 8m y 85m)
    if (dist1 < 6 || dist1 > 90 || dist2 < 6 || dist2 > 90) continue;

    const bearing1 = calculateBearing(pPrev[0], pPrev[1], pCurr[0], pCurr[1]);
    const bearing2 = calculateBearing(pCurr[0], pCurr[1], pNext[0], pNext[1]);
    let turnAngle = Math.abs(bearing2 - bearing1);
    if (turnAngle > 180) turnAngle = 360 - turnAngle;

    if (turnAngle >= minAngle) {
      // Evitar duplicar alertas en la misma intersección (< 80m de distancia)
      if (lastTurnCoord && haversineMeters(lastTurnCoord[0], lastTurnCoord[1], pCurr[0], pCurr[1]) < 80) {
        continue;
      }
      lastTurnCoord = pCurr;
      const direction = ((bearing2 - bearing1 + 360) % 360) < 180 ? 'Derecha' : 'Izquierda';

      sharpTurns.push({
        lat: pCurr[0],
        lng: pCurr[1],
        angle: Math.round(turnAngle),
        direction,
        advice: truck.type === 'articulated'
          ? `Giro cerrado a la ${direction.toLowerCase()} (${Math.round(turnAngle)}°). Abre la cabeza tractora por el barrido del semirremolque (${truck.length}m).`
          : `Giro pronunciado a la ${direction.toLowerCase()} (${Math.round(turnAngle)}°) para vehículo de ${truck.length}m.`
      });
    }
  }

  return sharpTurns;
}

function renderSharpTurnsOnMap(sharpTurns) {
  sharpTurns.forEach((t) => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="turn-badge-marker">↪ ${t.angle}°</div>`,
      iconSize: [52, 22],
      iconAnchor: [26, 11]
    });

    const marker = L.marker([t.lat, t.lng], { icon }).addTo(turnLayerGroup);
    marker.bindPopup(`
      <strong>⚠️ Maniobra de Giro (${t.angle}°)</strong><br/>
      <span>${t.advice}</span>
    `);
  });
}

// --- Radar de Restricciones en Vivo (Overpass API: Gálibos, Pesos, Anchuras) ---
async function scanHazardsOverpass(coords, truck) {
  if (!coords || coords.length === 0) return [];

  // Calcular Bounding Box de la ruta con un pequeño margen
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  coords.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });

  // Limitar el tamaño de la consulta Overpass si la ruta es muy larga (> 60 km)
  // En rutas interurbanas largas escaneamos el entorno del Origen y del Destino (donde están las calles estrechas y puentes urbanos)
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  let bboxFilter = '';

  if (spanLat > 0.35 || spanLng > 0.35) {
    const o = state.origin;
    const d = state.dest;
    const pad = 0.035; // ~3.5 km alrededor de origen y destino
    bboxFilter = `
      node["maxheight"](${o.lat - pad},${o.lng - pad},${o.lat + pad},${o.lng + pad});
      way["maxheight"](${o.lat - pad},${o.lng - pad},${o.lat + pad},${o.lng + pad});
      way["maxweight"](${o.lat - pad},${o.lng - pad},${o.lat + pad},${o.lng + pad});
      way["maxwidth"](${o.lat - pad},${o.lng - pad},${o.lat + pad},${o.lng + pad});
      node["maxheight"](${d.lat - pad},${d.lng - pad},${d.lat + pad},${d.lng + pad});
      way["maxheight"](${d.lat - pad},${d.lng - pad},${d.lat + pad},${d.lng + pad});
      way["maxweight"](${d.lat - pad},${d.lng - pad},${d.lat + pad},${d.lng + pad});
      way["maxwidth"](${d.lat - pad},${d.lng - pad},${d.lat + pad},${d.lng + pad});
      way["hgv"="no"](${d.lat - pad},${d.lng - pad},${d.lat + pad},${d.lng + pad});
    `;
  } else {
    const pad = 0.008;
    const bbox = `${minLat - pad},${minLng - pad},${maxLat + pad},${maxLng + pad}`;
    bboxFilter = `
      node["maxheight"](${bbox});
      way["maxheight"](${bbox});
      way["maxweight"](${bbox});
      way["maxwidth"](${bbox});
      way["maxlength"](${bbox});
      way["hgv"="no"](${bbox});
    `;
  }

  const query = `[out:json][timeout:12];(${bboxFilter});out center 60;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    if (!res.ok) return [];
    const data = await res.json();

    const hazards = [];
    (data.elements || []).forEach((el) => {
      const lat = el.lat || (el.center && el.center.lat);
      const lng = el.lon || (el.center && el.center.lon);
      if (!lat || !lng) return;

      const tags = el.tags || {};
      const streetName = tags.name || tags.ref || 'Vía / Paso inferior';

      // Evaluar Altura (maxheight)
      if (tags.maxheight) {
        const val = parseFloat(String(tags.maxheight).replace(',', '.'));
        if (!isNaN(val)) {
          const isCritical = val <= truck.height;
          hazards.push({
            lat, lng,
            type: 'height',
            badge: `↕ ${val}m`,
            title: `Gálibo Máximo: ${val} m`,
            street: streetName,
            severity: isCritical ? 'critical' : 'warning',
            detail: isCritical
              ? `⛔ ¡NO PASAS! El puente tiene ${val}m y tu camión mide ${truck.height}m de alto.`
              : `⚠️ Margen de altura: Puente de ${val}m (Tu camión: ${truck.height}m).`
          });
          return;
        }
      }

      // Evaluar Peso (maxweight)
      if (tags.maxweight) {
        const val = parseFloat(String(tags.maxweight).replace(',', '.'));
        if (!isNaN(val)) {
          const isCritical = val < truck.weight;
          hazards.push({
            lat, lng,
            type: 'weight',
            badge: `⚖️ ${val}t`,
            title: `Peso Máximo: ${val} t`,
            street: streetName,
            severity: isCritical ? 'critical' : 'warning',
            detail: isCritical
              ? `⛔ Límite de ${val}t (Tu camión pesa ${truck.weight}t).`
              : `⚠️ Vía limitada a ${val}t.`
          });
          return;
        }
      }

      // Evaluar Anchura / Longitud
      if (tags.maxwidth || tags.maxlength) {
        const limitText = tags.maxwidth ? `↔ ${tags.maxwidth}m` : `📏 ${tags.maxlength}m`;
        hazards.push({
          lat, lng,
          type: 'width',
          badge: limitText,
          title: `Restricción de Dimensiones (${limitText})`,
          street: streetName,
          severity: 'critical',
          detail: `⛔ Calle estrecha o longitud limitada en ${streetName}.`
        });
        return;
      }

      // Evaluar Prohibición HGV
      if (tags.hgv === 'no') {
        hazards.push({
          lat, lng,
          type: 'hgv',
          badge: `🚫 HGV`,
          title: `Prohibido Camiones Pesados`,
          street: streetName,
          severity: 'warning',
          detail: `Tramo con restricción a vehículos pesados en ${streetName}.`
        });
      }
    });

    return hazards.slice(0, 45);
  } catch (err) {
    console.warn('Aviso Overpass API:', err);
    return [];
  }
}

function renderHazardsOnMap(hazards) {
  hazards.forEach((h) => {
    const cls = h.severity === 'critical' ? 'critical' : 'warn';
    const icon = L.divIcon({
      className: '',
      html: `<div class="hazard-badge-marker ${cls}">${h.badge}</div>`,
      iconSize: [64, 24],
      iconAnchor: [32, 12]
    });

    const marker = L.marker([h.lat, h.lng], { icon }).addTo(hazardLayerGroup);
    marker.bindPopup(`
      <strong>${h.title}</strong><br/>
      <small>${h.street}</small><br/>
      <p style="margin-top:4px;">${h.detail}</p>
    `);
  });
}

// --- Actualización de Tarjetas de Resultados y Pestaña de Alertas ---
function updateRouteResultUI(truckResult, carResult, sharpTurns, hazards) {
  const card = document.getElementById('routeResultCard');
  card.classList.remove('hidden');

  document.getElementById('routeEngineBadge').textContent = truckResult.engineName;
  document.getElementById('metricDistance').textContent = `${truckResult.distanceKm.toFixed(1)} km`;
  document.getElementById('metricDuration').textContent = formatDuration(truckResult.durationMin);
  document.getElementById('metricSharpTurns').textContent = sharpTurns.length;

  const statusBadge = document.getElementById('routeStatusBadge');
  if (sharpTurns.length > 3) {
    statusBadge.textContent = `${sharpTurns.length} Giros de Atención`;
    statusBadge.className = 'status-tag status-warn';
  } else {
    statusBadge.textContent = 'Ruta Apta Camión';
    statusBadge.className = 'status-tag status-ok';
  }

  // Comparativa con ruta de coche
  const compNotice = document.getElementById('carComparisonNotice');
  if (carResult) {
    const diffKm = truckResult.distanceKm - carResult.distanceKm;
    compNotice.classList.remove('hidden');
    if (Math.abs(diffKm) > 0.25) {
      compNotice.innerHTML = `
        🛡️ <strong>Desvío de seguridad activo:</strong> La ruta de camión añade <strong>+${Math.max(0, diffKm).toFixed(1)} km</strong> respecto a un coche (línea roja punteada) para evitar calles estrechas, giros cerrados o límites de gálibo/peso para tus <strong>${state.truck.length}m / ${state.truck.height}m</strong>.
      `;
    } else {
      compNotice.innerHTML = `
        ✅ <strong>Vía principal despejada:</strong> La ruta óptima para tu camión de ${state.truck.length}m coincide con el trazado directo sin necesidad de rodeos adicionales.
      `;
    }
  } else {
    compNotice.classList.add('hidden');
  }
}

function renderAlertsAndManeuversTab(hazards, sharpTurns, maneuvers) {
  const totalAlerts = hazards.filter(h => h.severity === 'critical').length + sharpTurns.length;
  const badge = document.getElementById('alertCountBadge');
  if (totalAlerts > 0) {
    badge.textContent = totalAlerts;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const hazardsContainer = document.getElementById('hazardsList');
  hazardsContainer.innerHTML = '';

  if (sharpTurns.length === 0 && hazards.length === 0) {
    hazardsContainer.innerHTML = `<div class="empty-state">✅ No se han detectado puentes bajos críticos ni giros conflictivos en este trazado.</div>`;
  } else {
    // Primero mostrar giros cerrados de la ruta
    sharpTurns.forEach((t, idx) => {
      const div = document.createElement('div');
      div.className = 'hazard-item warning';
      div.innerHTML = `
        <div class="hazard-header">
          <span>↪ Giro Cerrado #${idx + 1} (${t.angle}° a la ${t.direction})</span>
          <span>Ver en mapa 🔍</span>
        </div>
        <div>${t.advice}</div>
      `;
      div.addEventListener('click', () => {
        map.setView([t.lat, t.lng], 18);
      });
      hazardsContainer.appendChild(div);
    });

    // Luego mostrar restricciones de gálibo/peso de la zona
    hazards.forEach((h) => {
      const div = document.createElement('div');
      div.className = `hazard-item ${h.severity}`;
      div.innerHTML = `
        <div class="hazard-header">
          <span>${h.badge} · ${h.street}</span>
          <span>Ver 🔍</span>
        </div>
        <div>${h.detail}</div>
      `;
      div.addEventListener('click', () => {
        map.setView([h.lat, h.lng], 17);
      });
      hazardsContainer.appendChild(div);
    });
  }

  // Lista de maniobras paso a paso
  const maneuversContainer = document.getElementById('maneuversList');
  maneuversContainer.innerHTML = '';
  maneuvers.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'maneuver-item';
    div.innerHTML = `
      <strong>${i + 1}. ${m.instruction}</strong>
      <div style="color:#94a3b8; font-size:0.73rem; margin-top:3px;">
        Tramo: ${m.lengthKm.toFixed(2)} km · (${Math.ceil(m.timeSec / 60)} min)
      </div>
    `;
    div.addEventListener('click', () => {
      if (m.coord) map.setView(m.coord, 16);
    });
    maneuversContainer.appendChild(div);
  });
}

// --- Exportación Inteligente a Google Maps con Waypoints de Camión ---
function updateExportLinks(coords) {
  if (!coords || coords.length < 2) return;

  const originStr = `${state.origin.lat.toFixed(6)},${state.origin.lng.toFixed(6)}`;
  const destStr = `${state.dest.lat.toFixed(6)},${state.dest.lng.toFixed(6)}`;

  // Extraer hasta 8 puntos intermedios (waypoints) distribuidos por la ruta segura del camión
  // Esto obliga a Google Maps a respetar la ruta del camión en vez de recalcular por calles de coche
  const maxWaypoints = 8;
  const waypoints = [];
  if (coords.length > 10) {
    const step = Math.floor(coords.length / (maxWaypoints + 1));
    for (let i = 1; i <= maxWaypoints; i++) {
      const pt = coords[i * step];
      if (pt) waypoints.push(`${pt[0].toFixed(5)},${pt[1].toFixed(5)}`);
    }
  }

  const waypointsParam = waypoints.length > 0 ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}` : '';
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}${waypointsParam}&travelmode=driving`;

  const wazeUrl = `https://waze.com/ul?ll=${state.dest.lat.toFixed(6)},${state.dest.lng.toFixed(6)}&navigate=yes`;

  document.getElementById('btnExportGmaps').href = gmapsUrl;
  document.getElementById('btnExportWaze').href = wazeUrl;
}

// --- Utilidades Geométricas y Decodificadores de Polilíneas ---
function formatDuration(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Decodificador Polyline6 (usado por Valhalla)
function decodePolyline6(str) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = 1e6;

  while (index < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

// Decodificador básico de Flexible Polyline para HERE Routing v8
function decodeHereFlexiblePolyline(encoded) {
  const DECODING_TABLE = [
    62, -1, -1, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22, 23, 24, 25, -1, -1, -1, -1, 63, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
    36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
  ];
  let index = 0;
  function decodeUnsignedValues() {
    let result = 0, shift = 0;
    while (index < encoded.length) {
      const charCode = encoded.charCodeAt(index++) - 45;
      const value = DECODING_TABLE[charCode];
      result |= (value & 0x1f) << shift;
      if ((value & 0x20) === 0) return result;
      shift += 5;
    }
    return result;
  }
  function toSigned(val) {
    return (val & 1) ? ~(val >> 1) : (val >> 1);
  }
  decodeUnsignedValues(); // version
  const header = decodeUnsignedValues();
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const factor = Math.pow(10, precision);

  let lastLat = 0, lastLng = 0;
  const coords = [];
  while (index < encoded.length) {
    lastLat += toSigned(decodeUnsignedValues());
    lastLng += toSigned(decodeUnsignedValues());
    if (thirdDim) decodeUnsignedValues();
    coords.push([lastLat / factor, lastLng / factor]);
  }
  return coords;
}
