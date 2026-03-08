import '../src/style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadEnv, getSlugFromUrl, EnvConfig } from '../src/shared/config';
import { track } from '../src/shared/analytics';

// EXPOSE THREE GLOBALLY for MindAR
(window as any).THREE = THREE;

declare const MINDAR: any;

let uiEl: HTMLElement;
let overlayEl: HTMLElement;
let config: EnvConfig | null = null;
let audio: HTMLAudioElement | null = null;

let camera: any;
let scene: any;
let renderer: any;
let controls: OrbitControls;

let placedObject: THREE.Object3D | null = null;

enum Platform {
    iOS,
    MindAR,
    Desktop
}

let currentPlatform: Platform = Platform.Desktop;
let mindarThree: any = null;
let currentFacingMode: 'user' | 'environment' = 'environment';

// Helper to load external scripts
function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Falló la carga de: ${src}`));
        document.head.appendChild(script);
    });
}

async function init() {
    uiEl = document.getElementById('ar-ui')!;
    overlayEl = document.getElementById('scanning-overlay')!;

    const params = new URLSearchParams(window.location.search);
    const faceParam = params.get('facingMode');
    if (faceParam === 'user' || faceParam === 'environment') {
        currentFacingMode = faceParam;
    }

    const slug = getSlugFromUrl();
    if (!slug) {
        if (uiEl) uiEl.innerHTML = '<p>Error: Falta el slug en URL.</p>';
        return;
    }

    try {
        config = await loadEnv(slug);
        updateUI();
        if (config.audio_preview_url) {
            audio = new Audio(config.audio_preview_url);
        }
        track('ar_init', { slug, facingMode: currentFacingMode });

        await checkPlatform();
        initAR();
    } catch (err) {
        console.error("Init error:", err);
        uiEl.innerHTML = '<p>Error al cargar configuración del AR.</p>';
    }
}

function updateUI() {
    if (!config) return;
    uiEl.innerHTML = `
        <div style="pointer-events: auto;">
            <p style="margin:0"><strong>Encuentro AR:</strong> ${config.title}</p>
            <button id="camera-toggle" style="
                margin-top: 8px;
                padding: 5px 10px;
                background: rgba(255,255,255,0.9);
                color: #000;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
            ">🔄 Cámara: ${currentFacingMode === 'environment' ? 'Trasera' : 'Frontal'}</button>
        </div>
    `;

    document.getElementById('camera-toggle')?.addEventListener('click', toggleCamera);
}

async function toggleCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    const url = new URL(window.location.href);
    url.searchParams.set('facingMode', currentFacingMode);
    window.history.replaceState({}, '', url.toString());

    if (currentPlatform === Platform.MindAR && mindarThree) {
        await mindarThree.stop();
        const tags = document.querySelectorAll('video, canvas');
        tags.forEach(t => {
            if (t.parentNode === document.body) {
                t.remove();
            }
        });
        setupMindAR();
    } else {
        window.location.reload();
    }
}

async function checkPlatform() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (config?.target_url) {
        currentPlatform = Platform.MindAR;
        return;
    }

    if (isIOS) {
        currentPlatform = Platform.iOS;
        return;
    }

    currentPlatform = Platform.Desktop;
}

async function initAR() {
    if (currentPlatform === Platform.MindAR) {
        setupMindAR();
    } else if (currentPlatform === Platform.iOS) {
        setupIOS();
    } else {
        setupDesktop();
    }
}

async function setupMindAR() {
    if (!config?.target_url) return;
    updateUI();

    overlayEl.classList.remove('hidden');
    overlayEl.innerHTML = `
        <div style="text-align: center;">
            <p id="scan-msg" style="margin-bottom: 20px;">Apunta la cámara a la hoja del libro...</p>
            <button id="start-ar-btn" style="
                padding: 15px 30px;
                background: #28a745;
                color: white;
                border: none;
                border-radius: 50px;
                font-size: 18px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            ">Iniciar Cámara AR</button>
        </div>
    `;

    const startBtn = document.getElementById('start-ar-btn');
    startBtn?.addEventListener('click', async () => {
        startBtn.innerHTML = "Cargando motor AR...";
        startBtn.style.opacity = "0.7";
        startBtn.style.pointerEvents = "none";

        try {
            console.log("Initializing MindAR 1.1.4 with facingMode:", currentFacingMode);

            // 1. Dynamic load MindAR 1.1.4 (Confirmed UMD/Global version)
            await loadScript('https://cdn.jsdelivr.net/npm/mind-ar@1.1.4/dist/mindar-image-three.prod.js');

            const MIND = (window as any).MINDAR;
            if (!MIND) throw new Error("La librería MindAR no se registró en el objeto global.");

            // 2. Verify marker
            const checkRes = await fetch(config!.target_url!, { method: 'HEAD' });
            if (!checkRes.ok) throw new Error("Archivo .mind no encontrado.");

            // 3. Patch getUserMedia
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (constraints: any) => {
                if (constraints && constraints.video) {
                    if (typeof constraints.video === 'boolean') {
                        constraints.video = { facingMode: currentFacingMode };
                    } else {
                        constraints.video.facingMode = currentFacingMode;
                    }
                }
                return await originalGetUserMedia(constraints);
            };

            mindarThree = new MIND.IMAGE.MindARThree({
                container: document.body,
                imageTargetSrc: config!.target_url!,
                uiLoading: "no",
                uiScanning: "no",
                filterMinCF: 0.0001,
                filterBeta: 0.001,
            });

            const { renderer: mRenderer, scene: mScene, camera: mCamera } = mindarThree;
            renderer = mRenderer;
            scene = mScene;
            camera = mCamera;

            renderer.domElement.style.position = 'fixed';
            renderer.domElement.style.top = '0';
            renderer.domElement.style.left = '0';
            renderer.domElement.style.width = '100vw';
            renderer.domElement.style.height = '100vh';
            renderer.domElement.style.zIndex = '1';

            const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
            scene.add(light);

            const anchor = mindarThree.addAnchor(0);

            const loader = new GLTFLoader();
            loader.load(config!.model_url, (gltf) => {
                const model = gltf.scene;
                model.scale.set(0.1, 0.1, 0.1);
                anchor.group.add(model);
                placedObject = model;
            });

            anchor.onTargetFound = () => {
                overlayEl.classList.add('hidden');
                const p = uiEl.querySelector('p');
                if (p) p.innerHTML = `<strong>${config?.title}:</strong> ¡Detectado!`;
                playAudio();
            };

            anchor.onTargetLost = () => {
                overlayEl.classList.remove('hidden');
                overlayEl.innerHTML = '<p>Apunta la cámara a la hoja del libro...</p>';
                const p = uiEl.querySelector('p');
                if (p) p.innerHTML = `<strong>Encuentro AR:</strong> ${config?.title}`;
            };

            await mindarThree.start();
            overlayEl.innerHTML = '<p>Apunta la cámara a la hoja del libro...</p>';

            const video = document.querySelector('video');
            if (video) {
                video.setAttribute('playsinline', '');
                video.setAttribute('webkit-playsinline', '');
                video.muted = true;
                video.style.position = 'fixed';
                video.style.top = '0';
                video.style.left = '0';
                video.style.width = '100vw';
                video.style.height = '100vh';
                video.style.objectFit = 'cover';
                video.style.zIndex = '0';
                video.play().catch(() => { });
            }

            renderer.setAnimationLoop(() => {
                renderer.render(scene, camera);
            });

            window.addEventListener('touchstart', handleTouchStart);

        } catch (err: any) {
            console.error("MindAR Setup Error:", err);
            startBtn.innerHTML = "Reintentar";
            startBtn.style.background = "#dc3545";
            startBtn.style.opacity = "1";
            startBtn.style.pointerEvents = "auto";
            uiEl.innerHTML += `<p style="color:#ffcc00; font-size:11px; margin-top:5px;">${err.message}</p>`;
        }
    });
}

function setupIOS() {
    uiEl.innerHTML += `
        <div style="margin-top: 1rem; pointer-events: auto;">
            <a href="${config?.usdz_url}" rel="ar" style="
                display: inline-block;
                padding: 10px 20px;
                background: #007AFF;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-weight: bold;
            ">Ver en AR Nativo (Quick Look)</a>
        </div>
    `;
    setupDesktop();
}

function setupDesktop() {
    overlayEl.classList.add('hidden');
    updateUI();
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 0, 2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100vw';
    renderer.domElement.style.height = '100vh';
    container.appendChild(renderer.domElement);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

    controls = new OrbitControls(camera, renderer.domElement);

    if (navigator.mediaDevices?.getUserMedia) {
        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.style.position = 'fixed';
        video.style.top = '0';
        video.style.left = '0';
        video.style.width = '100vw';
        video.style.height = '100vh';
        video.style.objectFit = 'cover';
        video.style.zIndex = '-1';

        navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        }).then(stream => {
            document.body.appendChild(video);
            video.srcObject = stream;
            video.play();
        }).catch(() => { });
    }

    const loader = new GLTFLoader();
    loader.load(config!.model_url, (gltf) => {
        const model = gltf.scene;
        model.position.set(0.5, -0.4, 0.5);
        scene.add(model);
        placedObject = model;
    });

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });

    window.addEventListener('click', () => playAudio());
}

function playAudio() {
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => { });
    }
}

let lastTouchX = 0;
function handleTouchStart(e: TouchEvent) {
    lastTouchX = e.touches[0].clientX;
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', () => {
        window.removeEventListener('touchmove', handleTouchMove);
    });
}

function handleTouchMove(e: TouchEvent) {
    if (!placedObject) return;
    const deltaX = e.touches[0].clientX - lastTouchX;
    placedObject.rotation.y += deltaX * 0.01;
    lastTouchX = e.touches[0].clientX;
}

window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});

init();
