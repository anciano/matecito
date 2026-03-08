import '../src/style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadEnv, getSlugFromUrl, EnvConfig } from '../src/shared/config';
import { track } from '../src/shared/analytics';

// MindAR is loaded via CDN in index.html, we access it via window
declare const MINDAR: any;

let uiEl: HTMLElement;
let overlayEl: HTMLElement;
let config: EnvConfig | null = null;
let audio: HTMLAudioElement | null = null;

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
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

async function init() {
    uiEl = document.getElementById('ar-ui')!;
    overlayEl = document.getElementById('scanning-overlay')!;

    // Check for camera override in URL
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
        console.error(err);
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
                background: #fff;
                color: #000;
                border: none;
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

    // Update URL without reloading (optional, but good for bookmarking)
    const url = new URL(window.location.href);
    url.searchParams.set('facingMode', currentFacingMode);
    window.history.replaceState({}, '', url.toString());

    if (currentPlatform === Platform.MindAR && mindarThree) {
        // Restart MindAR with new camera
        await mindarThree.stop();
        // Remove old video/canvas tags that MindAR might have added
        const tags = document.querySelectorAll('video, canvas');
        tags.forEach(t => {
            if (t.parentNode === document.body && t !== renderer.domElement) {
                t.remove();
            }
        });
        setupMindAR();
    } else {
        // For Desktop/Fallback, we might need a full reload or just restart setupDesktop
        window.location.reload();
    }
}

async function checkPlatform() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    // If config has target_url, we prefer MindAR
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
    updateUI(); // Refresh UI to show the correct camera mode

    // Before starting, we override the navigator.mediaDevices.getUserMedia to force the facing mode
    // MindAR uses this internally.
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints: any) => {
        if (constraints && constraints.video) {
            if (typeof constraints.video === 'boolean') {
                constraints.video = { facingMode: currentFacingMode };
            } else {
                constraints.video.facingMode = currentFacingMode;
            }
        }
        return originalGetUserMedia(constraints);
    };

    // Initialize MindAR Three.js wrapper
    mindarThree = new (window as any).MINDAR.IMAGE.MindARThree({
        container: document.body,
        imageTargetSrc: config.target_url,
        uiLoading: "no",
        uiScanning: "no",
    });

    const { renderer: mindRenderer, scene: mindScene, camera: mindCamera } = mindarThree;
    renderer = mindRenderer;
    scene = mindScene;
    camera = mindCamera;

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

    // Anchor for the first target
    const anchor = mindarThree.addAnchor(0);

    // Load model and add to anchor
    const loader = new GLTFLoader();
    loader.load(config.model_url, (gltf) => {
        const model = gltf.scene;
        model.scale.set(0.1, 0.1, 0.1); // Adjust scale for marker
        anchor.group.add(model);
        placedObject = model;
        track('ar_model_loaded', { slug: config!.slug });
    });

    // Events
    anchor.onTargetFound = () => {
        overlayEl.classList.add('hidden');
        const statusP = uiEl.querySelector('p');
        if (statusP) statusP.innerHTML = `<strong>${config?.title}:</strong> ¡Imagen detectada!`;
        track('ar_target_found', { slug: config!.slug });
        playAudio();
    };

    anchor.onTargetLost = () => {
        overlayEl.classList.remove('hidden');
        const statusP = uiEl.querySelector('p');
        if (statusP) statusP.innerHTML = `<strong>Encuentro AR:</strong> ${config?.title}`;
        track('ar_target_lost', { slug: config!.slug });
    };

    await mindarThree.start();

    renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
    });

    // Touch interaction for rotation/scale
    window.addEventListener('touchstart', handleTouchStart);
}

function setupIOS() {
    uiEl.innerHTML += `
        <div style="margin-top: 1rem;">
            <a href="${config?.usdz_url}" rel="ar" style="
                display: inline-block;
                padding: 10px 20px;
                background: #007AFF;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-weight: bold;
                pointer-events: auto;
            ">Ver en AR Nativo (iOS)</a>
        </div>
    `;
    setupDesktop();
}

function setupDesktop() {
    overlayEl.classList.add('hidden');
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 0, 2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

    controls = new OrbitControls(camera, renderer.domElement);

    // Webcam background
    if (navigator.mediaDevices?.getUserMedia) {
        const video = document.createElement('video');
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode }
        }).then(stream => {
            video.srcObject = stream;
            video.play();
            scene.background = new THREE.VideoTexture(video);
        });
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
        audio.play().catch(e => console.warn('Audio play failed', e));
    }
}

// Basic touch gestures for rotation
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
