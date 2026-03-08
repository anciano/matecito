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

async function init() {
    uiEl = document.getElementById('ar-ui')!;
    overlayEl = document.getElementById('scanning-overlay')!;
    const slug = getSlugFromUrl();
    if (!slug) {
        if (uiEl) uiEl.innerHTML = '<p>Error: Falta el slug en URL.</p>';
        return;
    }

    try {
        config = await loadEnv(slug);
        uiEl.innerHTML = `<p>Encuentro AR: ${config.title}</p>`;
        if (config.audio_preview_url) {
            audio = new Audio(config.audio_preview_url);
        }
        track('ar_init', { slug });

        await checkPlatform();
        initAR();
    } catch (err) {
        console.error(err);
        uiEl.innerHTML = '<p>Error al cargar configuración del AR.</p>';
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

    // Initialize MindAR Three.js wrapper
    mindarThree = new (window as any).MINDAR.IMAGE.MindARThree({
        container: document.body,
        imageTargetSrc: config.target_url,
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
        uiEl.innerHTML = `<p>${config?.title}: ¡Imagen detectada!</p>`;
        track('ar_target_found', { slug: config!.slug });
        playAudio();
    };

    anchor.onTargetLost = () => {
        overlayEl.classList.remove('hidden');
        uiEl.innerHTML = `<p>Buscando imagen...</p>`;
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
        navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
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
