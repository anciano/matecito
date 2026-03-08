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
        script.onerror = () => reject(new Error(`Falló: ${src}`));
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

function updateUI(statusMsg: string = "") {
    if (!config) return;
    uiEl.innerHTML = `
        <div style="pointer-events: auto;">
            <p style="margin:0"><strong>Encuentro AR:</strong> ${config.title}</p>
            <div id="debug-status" style="font-size: 10px; color: #ffcc00; margin-top: 4px;">${statusMsg}</div>
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

function setDebugStatus(msg: string) {
    const el = document.getElementById('debug-status');
    if (el) el.innerText = msg;
}

async function toggleCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    const url = new URL(window.location.href);
    url.searchParams.set('facingMode', currentFacingMode);
    window.history.replaceState({}, '', url.toString());
    window.location.reload();
}

async function checkPlatform() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (config?.target_url) { currentPlatform = Platform.MindAR; return; }
    if (isIOS) { currentPlatform = Platform.iOS; return; }
    currentPlatform = Platform.Desktop;
}

async function initAR() {
    if (currentPlatform === Platform.MindAR) setupMindAR();
    else if (currentPlatform === Platform.iOS) setupIOS();
    else setupDesktop();
}

async function setupMindAR() {
    if (!config?.target_url) return;
    updateUI("Listo para iniciar");

    overlayEl.classList.remove('hidden');
    overlayEl.innerHTML = `
        <div style="text-align: center;">
            <p id="scan-msg" style="margin-bottom: 20px;">Apunta la cámara a la hoja del libro...</p>
            <button id="start-ar-btn" style="
                padding: 15px 30px;
                background: #28a745;
                color: white;
                border: none; border-radius: 50px;
                font-size: 18px; font-weight: bold; cursor: pointer;
            ">Iniciar Cámara AR</button>
        </div>
    `;

    const startBtn = document.getElementById('start-ar-btn');
    startBtn?.addEventListener('click', async () => {
        startBtn.innerHTML = "Cargando motor...";
        startBtn.style.pointerEvents = "none";

        try {
            setDebugStatus("Cargando MindAR...");
            await loadScript('https://cdn.jsdelivr.net/npm/mind-ar@1.1.4/dist/mindar-image-three.prod.js');

            const MIND = (window as any).MINDAR;
            if (!MIND) throw new Error("Librería no encontrada");

            // Patch getUserMedia
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async (constraints: any) => {
                try {
                    if (constraints && constraints.video) {
                        if (typeof constraints.video === 'boolean') {
                            constraints.video = { facingMode: currentFacingMode, width: { ideal: 1280 } };
                        } else {
                            constraints.video.facingMode = currentFacingMode;
                            constraints.video.width = { ideal: 1280 };
                        }
                    }
                    return await originalGetUserMedia(constraints);
                } catch (e: any) {
                    console.error("getUserMedia Error:", e);
                    if (e.name === 'NotReadableError' || (e.message && e.message.includes('in use'))) {
                        throw new Error("Cámara en uso por otra app/pestaña. Recarga la página.");
                    } else if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') {
                        console.warn("Camera fallback: trying without facingMode constraints");
                        if (constraints && typeof constraints.video === 'object') {
                            delete constraints.video.facingMode;
                            delete constraints.video.width;
                            delete constraints.video.height;
                        }
                        return await originalGetUserMedia(constraints);
                    }
                    throw e;
                }
            };

            // Create a dedicated container for MindAR
            let arContainer = document.getElementById('ar-container');
            if (!arContainer) {
                arContainer = document.createElement('div');
                arContainer.id = 'ar-container';
                arContainer.style.position = 'fixed';
                arContainer.style.top = '0';
                arContainer.style.left = '0';
                arContainer.style.width = '100vw';
                arContainer.style.height = '100vh';
                arContainer.style.overflow = 'hidden';
                // CRUCIAL: Must be positive so it's not hidden behind the body background
                // but lower than UI elements (z-index 90-100)
                arContainer.style.zIndex = '1';
                document.body.appendChild(arContainer);
            }

            mindarThree = new MIND.IMAGE.MindARThree({
                container: arContainer,
                imageTargetSrc: config!.target_url!,
                uiLoading: "no",
                uiScanning: "no",
            });

            const { renderer: mRenderer, scene: mScene, camera: mCamera } = mindarThree;
            renderer = mRenderer;
            scene = mScene;
            camera = mCamera;

            // Simple basic scene setup for visibility
            const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
            scene.add(light);
            scene.add(new THREE.AmbientLight(0xffffff, 0.8));

            const anchor = mindarThree.addAnchor(0);

            // 1. Red Cube - Basic implementation
            const cube = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, 0.2, 0.2),
                new THREE.MeshBasicMaterial({ color: 0xff0000 })
            );
            cube.position.set(0, 0, 0);
            anchor.group.add(cube);

            setDebugStatus("Descargando Matecito...");
            const loader = new GLTFLoader();
            loader.load(config!.model_url, (gltf) => {
                const model = gltf.scene;

                // Centering and scaling logic
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                model.position.x += (model.position.x - center.x);
                model.position.y += (model.position.y - center.y);
                model.position.z += (model.position.z - center.z);

                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 0.5 / (maxDim || 1);
                model.scale.set(scale, scale, scale);

                // Ensure visibility
                model.traverse((node: any) => {
                    if (node.isMesh) node.frustumCulled = false;
                });

                // MindAR alignment
                model.rotation.x = Math.PI / 2;
                model.position.y += 0.05;

                anchor.group.add(model);
                placedObject = model;
                setDebugStatus(`Matecito OK (Scale: ${scale.toFixed(2)})`);
                console.log("Model loaded", scale);
            }, undefined, (e) => {
                setDebugStatus("Error de carga GLB");
                console.error(e);
            });

            anchor.onTargetFound = () => {
                overlayEl.classList.add('hidden');
                setDebugStatus("¡Objetivo Detectado!");
                playAudio();
            };

            anchor.onTargetLost = () => {
                overlayEl.classList.remove('hidden');
                setDebugStatus("Buscando imagen...");
            };

            await mindarThree.start();
            setDebugStatus("Escanea la hoja");
            overlayEl.innerHTML = `<div style="border: 2px dashed rgba(255,255,255,0.5); padding: 20px; border-radius: 10px;"><p style="margin:0">Encuadra la imagen</p></div>`;

            // Ensure video plays inline for iOS Safari
            const video = document.querySelector('video');
            if (video) {
                video.setAttribute('playsinline', '');
                video.setAttribute('webkit-playsinline', '');
                video.muted = true;
                video.play().catch(() => { });
            }

            renderer.setAnimationLoop(() => {
                renderer.render(scene, camera);
            });

            window.addEventListener('touchstart', handleTouchStart);

        } catch (err: any) {
            console.error("MindAR Setup Error:", err);
            setDebugStatus(`Fallo: ${err?.message || 'Error desconocido'}`);
            if (startBtn) {
                startBtn.innerHTML = "Reintentar";
                startBtn.style.background = "#dc3545"; // Red color for error
                startBtn.style.pointerEvents = "auto";
            }
        }
    });
}

function setupIOS() {
    uiEl.innerHTML += `<div style="margin-top: 1rem; pointer-events: auto;"><a href="${config?.usdz_url}" rel="ar" style="display: inline-block; padding: 10px 20px; background: #007AFF; color: white; text-decoration: none; border-radius: 10px; font-weight: bold;">Ver en AR Nativo</a></div>`;
    setupDesktop();
}

function setupDesktop() {
    overlayEl.classList.add('hidden');
    updateUI("Desktop View");
    const container = document.createElement('div');
    document.body.appendChild(container);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 0, 2);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0'; renderer.domElement.style.left = '0';
    container.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
    controls = new OrbitControls(camera, renderer.domElement);

    if (navigator.mediaDevices?.getUserMedia) {
        const video = document.createElement('video');
        video.setAttribute('playsinline', ''); video.muted = true;
        video.style.position = 'fixed'; video.style.top = '0'; video.style.left = '0';
        video.style.width = '100vw'; video.style.height = '100vh';
        video.style.objectFit = 'cover'; video.style.zIndex = '-1';
        navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } }).then(stream => {
            document.body.appendChild(video); video.srcObject = stream; video.play();
        }).catch(() => { });
    }

    const loader = new GLTFLoader();
    loader.load(config!.model_url, (gltf) => {
        const model = gltf.scene;
        model.position.set(0, -0.4, 0);
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
    if (audio) { audio.currentTime = 0; audio.play().catch(() => { }); }
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
