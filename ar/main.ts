import '../src/style.css';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadEnv, getSlugFromUrl, EnvConfig } from '../src/shared/config';
import { track } from '../src/shared/analytics';

const uiEl = document.getElementById('ar-ui')!;
let config: EnvConfig | null = null;
let audio: HTMLAudioElement | null = null;

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller: THREE.XRTargetRaySpace;

let reticle: THREE.Mesh;
let hitTestSource: XRHitTestSource | null = null;
let hitTestSourceRequested = false;

let placedObject: THREE.Object3D | null = null;
const raycaster = new THREE.Raycaster();

async function init() {
    const slug = getSlugFromUrl();
    if (!slug) {
        uiEl.innerHTML = '<p>Error: Falta el slug en URL.</p>';
        return;
    }

    try {
        config = await loadEnv(slug);
        uiEl.innerHTML = `<p>Encuentro AR: ${config.title}</p>`;
        if (config.audio_preview_url) {
            audio = new Audio(config.audio_preview_url);
        }
        track('ar_init', { slug });

        initThree();
    } catch (err) {
        console.error(err);
        uiEl.innerHTML = '<p>Error al cargar configuración del AR.</p>';
    }
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
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // ARButton adds the "Start AR" button
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // XR Controller
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    // Reticle
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    window.addEventListener('resize', onWindowResize);

    renderer.setAnimationLoop(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onSelect() {
    if (reticle.visible && !placedObject) {
        placeObject();
    } else if (placedObject) {
        checkInteraction();
    }
}

function placeObject() {
    if (!config) return;

    uiEl.innerHTML = '<p>Cargando modelo...</p>';

    // Create a placeholder while loading
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff * Math.random() });
    const placeholder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
    placeholder.position.setFromMatrixPosition(reticle.matrix);
    scene.add(placeholder);
    placedObject = placeholder;

    track('ar_model_placing', { slug: config.slug });

    const loader = new GLTFLoader();
    loader.load(
        config.model_url,
        (gltf) => {
            scene.remove(placeholder);
            const model = gltf.scene;
            model.position.setFromMatrixPosition(reticle.matrix);
            // scale if needed, assuming 1 unit = 1 meter
            model.scale.set(1, 1, 1);

            scene.add(model);
            placedObject = model;
            uiEl.innerHTML = '<p>¡Toca el animal para interactuar!</p>';
            track('ar_model_loaded', { slug: config!.slug });
        },
        undefined,
        (error) => {
            console.warn('Fallback: Failed to load GLTF, using placeholder', error);
            uiEl.innerHTML = '<p>¡Modelo no encontrado! (Placeholder cargado)</p>';
            track('ar_model_error', { slug: config!.slug });
        }
    );

    reticle.visible = false;
}

function checkInteraction() {
    // Raycast from controller to placed object
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    if (placedObject) {
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
    if (frame) {
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

            // Only show reticle if we haven't placed the object yet
            if (hitTestResults.length > 0 && !placedObject) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);
                if (pose) {
                    reticle.visible = true;
                    reticle.matrix.fromArray(pose.transform.matrix);
                }
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}

init();
