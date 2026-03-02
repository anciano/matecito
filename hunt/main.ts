import '../src/style.css';
import { loadEnv, getSlugFromUrl, EnvConfig } from '../src/shared/config';
import { Coordinates, generateRandomSpawn, getDistanceMeters } from '../src/shared/geo';
import { storage } from '../src/shared/storage';
import { track } from '../src/shared/analytics';

interface HuntState {
    spawnLat: number;
    spawnLng: number;
    originLat: number;
    originLng: number;
    timestamp: number;
}

const appEl = document.querySelector<HTMLDivElement>('#app')!;
appEl.innerHTML = `
  <div>
    <h1 id="title">Cargando...</h1>
    <p id="status">Obteniendo ubicación y configuración...</p>
    <div id="debug-info" style="font-size: 0.8em; color: #888; margin-top: 1rem;"></div>
    <button id="btn-ar" class="hidden">Abrir encuentro AR</button>
    <div style="margin-top: 2rem;">
      <button id="btn-force" style="font-size: 0.7em; opacity: 0.5;">Forzar Modo AR (Debug)</button>
    </div>
  </div>
`;

const titleEl = document.getElementById('title')!;
const statusEl = document.getElementById('status')!;
const debugEl = document.getElementById('debug-info')!;
const btnAr = document.getElementById('btn-ar')! as HTMLButtonElement;
const btnForce = document.getElementById('btn-force')! as HTMLButtonElement;

let config: EnvConfig | null = null;
let huntState: HuntState | null = null;
let watchId: number | null = null;

async function init() {
    const slug = getSlugFromUrl();
    if (!slug) {
        statusEl.innerHTML = 'Error: Falta el parámetro ?slug en la URL.';
        return;
    }

    try {
        config = await loadEnv(slug);
        titleEl.textContent = `Buscando: ${config.title}`;
        track('hunt_init', { slug });
        startTracking();

        btnForce.onclick = () => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            window.location.href = config!.ar_url || `/ar/?slug=${config!.slug}`;
        };
    } catch (err) {
        statusEl.innerHTML = `Error: No se pudo cargar la configuración para "${slug}".`;
        console.error(err);
    }
}

function startTracking() {
    if (!navigator.geolocation) {
        statusEl.innerHTML = 'Error: Geolocalización no soportada por el navegador.';
        return;
    }

    statusEl.innerHTML = 'Esperando señal GPS...';

    watchId = navigator.geolocation.watchPosition(
        onPositionUpdate,
        (err) => {
            statusEl.innerHTML = `Error GPS: ${err.message}`;
            console.warn('Geolocation error', err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
}

function onPositionUpdate(pos: GeolocationPosition) {
    if (!config) return;

    const currentCoords: Coordinates = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
    };
    const accuracy = pos.coords.accuracy;

    debugEl.innerHTML = `Precisión: ${accuracy.toFixed(1)}m`;

    // Relaxed for testing: Only block if accuracy > 150m.
    // Otherwise, just show a warning but allow the logic to proceed.
    if (accuracy > 150) {
        statusEl.innerHTML = `Señal GPS muy débil (${accuracy.toFixed(1)}m). Esperando...`;
        btnAr.classList.add('hidden');
        return;
    }

    if (accuracy > config.min_accuracy_m) {
        debugEl.innerHTML += ` <span style="color:orange">(Baja precisión)</span>`;
    }

    handleValidPosition(currentCoords);
}

function handleValidPosition(currentCoords: Coordinates) {
    if (!config) return;
    const stateKey = `hunt_state_${config.slug}`;

    if (!huntState) {
        huntState = storage.get<HuntState>(stateKey);
        // if state too old (e.g. > 1 hour), discard
        if (huntState && Date.now() - huntState.timestamp > 3600_000) {
            huntState = null;
        }

        if (!huntState) {
            // Create new spawn point
            const [minDist, maxDist] = config.spawn_distance_m;
            const spawnCoords = generateRandomSpawn(currentCoords, minDist, maxDist);

            huntState = {
                originLat: currentCoords.latitude,
                originLng: currentCoords.longitude,
                spawnLat: spawnCoords.latitude,
                spawnLng: spawnCoords.longitude,
                timestamp: Date.now()
            };

            storage.set(stateKey, huntState);
            track('spawn_created', { slug: config.slug, distance: getDistanceMeters(currentCoords, spawnCoords) });
        }
    }

    const originCoords: Coordinates = { latitude: huntState.originLat, longitude: huntState.originLng };
    const distanceFromOrigin = getDistanceMeters(originCoords, currentCoords);

    debugEl.innerHTML += `<br/>Movimiento real: ${distanceFromOrigin.toFixed(1)}m / ${config.min_move_m}m`;

    if (distanceFromOrigin >= config.min_move_m) {
        statusEl.innerHTML = '¡Rastro encontrado!';
        btnAr.classList.remove('hidden');
        btnAr.onclick = () => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            window.location.href = config!.ar_url || `/ar/?slug=${config!.slug}`;
        };
    } else {
        statusEl.innerHTML = `Camina un poco para encontrar el rastro... (${distanceFromOrigin.toFixed(1)}m/${config.min_move_m}m)`;
        btnAr.classList.add('hidden');
    }
}

init();
