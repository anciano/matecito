import '../src/style.css';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadEnv, getSlugFromUrl, EnvConfig } from '../src/shared/config';
import { track } from '../src/shared/analytics';

let uiEl: HTMLElement;
let config: EnvConfig | null = null;
let audio: HTMLAudioElement | null = null;

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller: THREE.XRTargetRaySpace;
let controls: OrbitControls;

let reticle: THREE.Mesh;
let hitTestSource: XRHitTestSource | null = null;
let hitTestSourceRequested = false;

let placedObject: THREE.Object3D | null = null;
const raycaster = new THREE.Raycaster();

enum Platform {
    iOS,
    WebXR,
    Desktop
}

let currentPlatform: Platform = Platform.Desktop;

async function init() {
    uiEl = document.getElementById('ar-ui')!;
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
        initThree();
    } catch (err) {
        console.error(err);
        uiEl.innerHTML = '<p>Error al cargar configuración del AR.</p>';
    }
}

async function checkPlatform() {
    // Check for iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
        currentPlatform = Platform.iOS;
        return;
    }

    // Check for WebXR support
    if ('xr' in navigator) {
        const isSupported = await (navigator as any).xr.isSessionSupported('immersive-ar');
        if (isSupported) {
            currentPlatform = Platform.WebXR;
            return;
        }
    }

    currentPlatform = Platform.Desktop;
}

function initThree() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    if (currentPlatform === Platform.WebXR) {
        setupWebXR();
    } else if (currentPlatform === Platform.iOS) {
        setupIOS();
    } else {
        setupDesktop();
    }

    window.addEventListener('resize', onWindowResize);
}

function setupWebXR() {
    renderer.xr.enabled = true;
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    renderer.setAnimationLoop(animate);
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
            ">Ver en AR (iOS)</a>
        </div>
    `;
    // Fallback to desktop viewer on top of the link
    setupDesktop();
}

function setupDesktop() {
    camera.position.set(0, 0, 2);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    uiEl.innerHTML += '<p style="font-size: 0.8em; opacity: 0.7;">(Cámara Web Activa - Mueve al Matecito)</p>';

    // Setup Webcam Background
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');

        navigator.mediaDevices.getUserMedia({ video: true })
            .then((stream) => {
                video.srcObject = stream;
                video.play();
                const videoTexture = new THREE.VideoTexture(video);
                scene.background = videoTexture;
            })
            .catch((err) => {
                console.error('No se pudo acceder a la webcam:', err);
                uiEl.innerHTML += '<p style="color:red">Error webcam: Permitir acceso para AR Desktop</p>';
            });
    }

    // Load model for Desktop (positioned to the side/shoulder area)
    loadModelAt(new THREE.Vector3(0.5, -0.4, 0.5));

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
    if (currentPlatform !== Platform.WebXR) {
        checkInteraction();
        return;
    }

    if (reticle.visible && !placedObject) {
        const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        loadModelAt(position);
    } else if (placedObject) {
        checkInteraction();
    }
}

function loadModelAt(position: THREE.Vector3) {
    if (!config) return;

    const loader = new GLTFLoader();
    loader.load(
        config.model_url,
        (gltf) => {
            if (placedObject) scene.remove(placedObject);
            const model = gltf.scene;
            model.position.copy(position);
            // Default scale for GLB
            model.scale.set(1, 1, 1);
            scene.add(model);
            placedObject = model;
            track('ar_model_loaded', { slug: config!.slug });
        },
        undefined,
        (error) => {
            console.warn('Fallback: Failed to load GLTF, using box', error);
            if (placedObject) scene.remove(placedObject);
            const material = new THREE.MeshPhongMaterial({ color: 0x666666 });
            const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
            placeholder.position.copy(position);
            scene.add(placeholder);
            placedObject = placeholder;
            track('ar_model_error', { slug: config!.slug });
        }
    );

    if (reticle) reticle.visible = false;
}

function checkInteraction() {
    // For Desktop/iOS viewer, any click plays audio
    if (currentPlatform !== Platform.WebXR) {
        playAudio();
        return;
    }

    if (placedObject) {
        const tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersects = raycaster.intersectObject(placedObject, true);
        if (intersects.length > 0) {
            playAudio();
        }
    }
}

function playAudio() {
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.warn('Audio play failed', e));
        track('ar_audio_played', { slug: config?.slug });
    }
}

function animate(_timestamp: number, frame: XRFrame | undefined) {
    if (frame && currentPlatform === Platform.WebXR) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (!hitTestSourceRequested && session) {
            session.requestReferenceSpace('viewer').then((viewerSpace) => {
                const xrSession = session as any;
                if (xrSession.requestHitTestSource) {
                    xrSession.requestHitTestSource({ space: viewerSpace }).then((source: XRHitTestSource) => {
                        hitTestSource = source;
                    });
                }
            });
            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource && referenceSpace) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0 && !placedObject) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);
                if (pose) {
                    reticle.visible = true;
                    reticle.matrix.fromArray(pose.transform.matrix);

                    // AUTO-PLACEMENT: 
                    // Se posiciona automáticamente en la primera superficie estable detectada.
                    const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
                    loadModelAt(position);
                }
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}

init();
