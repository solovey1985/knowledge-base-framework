type ThreeModule = typeof import('three');
type OrbitControlsModule = typeof import('three/examples/jsm/controls/OrbitControls.js');
type STLLoaderModule = typeof import('three/examples/jsm/loaders/STLLoader.js');
type OBJLoaderModule = typeof import('three/examples/jsm/loaders/OBJLoader.js');

const SUPPORTED_FORMATS = ['stl', 'obj', '3mf'];

type ThreeDeps = {
  THREE: ThreeModule;
  OrbitControls: OrbitControlsModule['OrbitControls'];
  STLLoader: STLLoaderModule['STLLoader'];
  OBJLoader: OBJLoaderModule['OBJLoader'];
};

type ModelRotation = {
  x: number;
  y: number;
  z: number;
};

const DEFAULT_BACKGROUND_COLOR = '#cccccc';
const DEFAULT_MODEL_ROTATION: ModelRotation = { x: 0, y: 0, z: 0 };

let dependenciesLoader: Promise<ThreeDeps> | null = null;

async function loadObj(loader: InstanceType<ThreeDeps['OBJLoader']>, modelUrl: string, signal: AbortSignal) {
  const response = await fetch(modelUrl, { signal });
  if (!response.ok) throw new Error(`Could not load OBJ (HTTP ${response.status}).`);
  const source = await response.text();
  const library = /^\s*mtllib[ \t]+([^\r\n]+)/m.exec(source)?.[1].trim();
  if (library) {
    try {
      const directory = new URL('.', new URL(modelUrl, window.location.href));
      // Keep model dependencies inside the model directory and on the same site.
      const isLocalAsset = (url: URL) => url.origin === window.location.origin &&
        url.pathname.startsWith(directory.pathname) && !/%2f|%5c/i.test(url.pathname);
      const materialUrl = new URL(library, directory);
      if (isLocalAsset(materialUrl) && materialUrl.pathname.toLowerCase().endsWith('.mtl')) {
        const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
        const materialResponse = await fetch(materialUrl, { signal, redirect: 'error' });
        if (materialResponse.ok) {
          const { LoadingManager } = await import('three');
          const manager = new LoadingManager().setURLModifier(value => {
            const url = new URL(value, directory);
            // An in-memory image stands in for blocked texture references.
            return isLocalAsset(url) ? url.href : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          });
          const materials = new MTLLoader(manager).parse(await materialResponse.text(), new URL('.', materialUrl).href);
          if (!signal.aborted) loader.setMaterials(materials);
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // Optional materials must not prevent geometry from opening.
    }
  }
  if (signal.aborted) throw signal.reason;
  try {
    return loader.parse(source);
  } catch (error) {
    if (!loader.materials) throw error;
    return new (loader.constructor as ThreeDeps['OBJLoader'])().parse(source);
  }
}

function loadDependencies(): Promise<ThreeDeps> {
  if (!dependenciesLoader) {
    // Bundled with the framework; downloaded only by model pages.
    dependenciesLoader = Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/loaders/STLLoader.js'),
      import('three/examples/jsm/loaders/OBJLoader.js')
    ]).then(([THREE, orbit, stl, obj]) => ({
      THREE,
      OrbitControls: orbit.OrbitControls,
      STLLoader: stl.STLLoader,
      OBJLoader: obj.OBJLoader
    }));
  }
  return dependenciesLoader;
}

export type ViewOptions = {
  lighting: 'standard' | 'soft' | 'camera';
  materials: boolean;
  shading: boolean;
  lines: boolean;
  wireframe: boolean;
};

export interface ViewerControls {
  reset(): void;
  appearance(options: ViewOptions): void;
  walk(onChange: (active: boolean) => void): void;
  stopWalking(): void;
  move(key: string, pressed: boolean): void;
}

/** React owns the controls. Three owns the canvas, observer and GPU resources. */
export async function bootViewer(host: HTMLElement, source: HTMLElement, signal: AbortSignal): Promise<ViewerControls | undefined> {
  const modelUrl = source.getAttribute('data-model-url') || '';
  const modelFormat = (source.getAttribute('data-model-format') || '').toLowerCase();
  const backgroundColor = source.getAttribute('data-background-color') || DEFAULT_BACKGROUND_COLOR;
  const modelRotation = parseModelRotation(source.getAttribute('data-model-rotation'));
  if (!modelUrl || !modelFormat) {
    throw new Error('Model path is missing.');
  }

  if (!SUPPORTED_FORMATS.includes(modelFormat)) {
    throw new Error(`Unsupported model format: ${modelFormat}`);
  }

  const [{ THREE, OrbitControls, STLLoader, OBJLoader }, { PointerLockControls }] = await Promise.all([
    loadDependencies(),
    import('three/examples/jsm/controls/PointerLockControls.js')
  ]);

  if (signal.aborted) return;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(backgroundColor);

  const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.001, 1000000);
  camera.position.set(0, 1.6, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const walkControls = new PointerLockControls(camera, renderer.domElement);
  const keys = new Set<string>();
  const touchKeys = new Set<string>();
  const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ']);
  let onWalkChange: ((active: boolean) => void) | undefined;
  let walking = false;
  let drag: { id: number; x: number; y: number } | undefined;
  const angles = new THREE.Euler(0, 0, 0, 'YXZ');
  const canvas = renderer.domElement;
  const orbitPosition = camera.position.clone();
  const orbitRotation = camera.quaternion.clone();
  const clearKeys = () => { keys.clear(); touchKeys.clear(); drag = undefined; };
  function keyDown(event: KeyboardEvent) {
    if (!walking) return;
    if (event.code === 'Escape') { stopWalking(); return; }
    if (!movementKeys.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  }
  function keyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function stopWalking() {
    if (!walking) return;
    walking = false;
    clearKeys();
    if (walkControls.isLocked) walkControls.unlock();
    camera.position.copy(orbitPosition);
    camera.quaternion.copy(orbitRotation);
    controls.enabled = true;
    onWalkChange?.(false);
  }
  walkControls.addEventListener('unlock', stopWalking);
  walkControls.addEventListener('lock', () => {
    if (!walking) walkControls.unlock();
  });
  // Pointer capture keeps drag-to-look active when the finger leaves the canvas.
  canvas.addEventListener('pointerdown', event => {
    if (!walking || walkControls.isLocked || drag || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    angles.setFromQuaternion(camera.quaternion);
    angles.y -= (event.clientX - drag.x) * 0.004;
    angles.x = THREE.MathUtils.clamp(angles.x - (event.clientY - drag.y) * 0.004, -1.55, 1.55);
    camera.quaternion.setFromEuler(angles);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = undefined;
  });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', clearKeys);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, 0.95);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 1.1);
  directional.position.set(3, 6, 4);
  scene.add(directional);

  const root = new THREE.Group();
  root.rotation.set(
    THREE.MathUtils.degToRad(modelRotation.x),
    THREE.MathUtils.degToRad(modelRotation.y),
    THREE.MathUtils.degToRad(modelRotation.z)
  );
  scene.add(root);

  let frame = 0;
  let observer: ResizeObserver | undefined;
  let disposeAppearance: (() => void) | undefined;
  function dispose() {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls.dispose();
    if (walkControls.isLocked) walkControls.unlock();
    walkControls.dispose();
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    window.removeEventListener('blur', clearKeys);
    disposeAppearance?.();
    disposeAppearance = undefined;
    root.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(material => material.dispose());
      }
    });
    root.clear();
    renderer.dispose();
    renderer.domElement.remove();
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (modelFormat === 'stl') {
      const loader = new STLLoader();
      const geometry = await loader.loadAsync(modelUrl);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: 0x93c5fd, metalness: 0.12, roughness: 0.7 });
      const mesh = new THREE.Mesh(geometry, material);
      root.add(mesh);
    }

    if (modelFormat === 'obj') {
      const loader = new OBJLoader();
      const object = await loadObj(loader, modelUrl, signal);
      object.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        if (!node.material) {
          node.material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.08, roughness: 0.75 });
        }
        // CAD exports can have inward-facing or mixed face winding.
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) material.side = THREE.DoubleSide;
      });
      root.add(object);
    }

    if (modelFormat === '3mf') {
      // Loaded on demand: 3MF needs a ZIP decoder that STL and OBJ pages should not download.
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      root.add(await new ThreeMFLoader().loadAsync(modelUrl));
    }

    if (signal.aborted) {
      dispose();
      return;
    }
    const fit = fitModel(THREE, root, camera, controls);
    const meshes: import('three').Mesh[] = [];
    root.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
    const originals = meshes.map(mesh => mesh.material);
    const replacements = new Map<import('three').Material, import('three').Material[]>();
    const edges = new Map<import('three').Mesh, import('three').LineSegments>();
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x202938 });
    let lighting: ViewOptions['lighting'] = 'standard';

    function appearance(options: ViewOptions) {
      lighting = options.lighting;
      ambient.intensity = lighting === 'soft' ? 1.35 : 0.95;
      directional.intensity = lighting === 'soft' ? 0.35 : 1.1;
      directional.position.set(3, 6, 4);
      meshes.forEach((mesh, index) => {
        const original = originals[index];
        const useOriginal = options.materials && options.shading;
        const materials = Array.isArray(original) ? original : [original];
        const visible = useOriginal ? materials : materials.map(material => {
          let variants = replacements.get(material);
          if (!variants) {
            const surface = material as import('three').MeshPhongMaterial;
            variants = [
              new THREE.MeshStandardMaterial({ color: 0xcbd5e1, side: material.side }),
              new THREE.MeshBasicMaterial({ color: 0xcbd5e1, side: material.side }),
              new THREE.MeshBasicMaterial({
                color: surface.color ?? 0xffffff, map: surface.map ?? null,
                vertexColors: material.vertexColors, side: material.side,
                opacity: material.opacity, transparent: material.transparent,
                alphaMap: surface.alphaMap ?? null, alphaTest: material.alphaTest
              })
            ];
            replacements.set(material, variants);
          }
          return variants[options.shading ? 0 : options.materials ? 2 : 1];
        });
        mesh.material = Array.isArray(original) ? visible : visible[0];

        // Build the edge overlay on first use; reuse it on subsequent toggles.
        let overlay = edges.get(mesh);
        if (!overlay && options.lines && !options.wireframe) {
          overlay = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), edgeMaterial);
          edges.set(mesh, overlay);
          mesh.add(overlay);
        }
        if (overlay) overlay.visible = options.lines && !options.wireframe;
      });
      setWireframe(root, options.wireframe);
    }

    disposeAppearance = () => {
      meshes.forEach((mesh, index) => { mesh.material = originals[index]; });
      for (const variants of replacements.values()) variants.forEach(material => material.dispose());
      for (const overlay of edges.values()) {
        overlay.removeFromParent();
        overlay.geometry.dispose();
      }
      edgeMaterial.dispose();
    };


    observer = new ResizeObserver(() => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    observer.observe(host);

    let previousFrame = performance.now();
    const animate = (now = performance.now()) => {
      const elapsed = Math.min((now - previousFrame) / 1000, 0.05);
      previousFrame = now;
      if (walking) {
        const pressed = (key: string) => Number(keys.has(key) || touchKeys.has(key));
        const forward = pressed('KeyW') - pressed('KeyS');
        const right = pressed('KeyD') - pressed('KeyA');
        const vertical = pressed('KeyE') - pressed('KeyQ');
        const distance = elapsed * fit.maxDim * 0.35 / Math.max(1, Math.hypot(forward, right, vertical));
        walkControls.moveForward(forward * distance);
        walkControls.moveRight(right * distance);
        camera.position.y += vertical * distance;
      } else {
        controls.update();
      }
      if (lighting === 'camera') directional.position.copy(camera.position).sub(controls.target);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

    animate();
    return {
      reset: fit.reset,
      appearance,
      walk(onChange) {
        if (walking) return;
        onWalkChange = onChange;
        orbitPosition.copy(camera.position);
        orbitRotation.copy(camera.quaternion);
        controls.enabled = false;
        walking = true;
        onWalkChange(true);
        if (!window.matchMedia('(any-pointer: coarse)').matches && typeof canvas.requestPointerLock === 'function') {
          // Drag remains available if the browser denies pointer lock.
          Promise.resolve(walkControls.lock()).catch(() => {});
        }
      },
      stopWalking,
      move(key, pressed) {
        if (!walking || !movementKeys.has(key)) return;
        if (pressed) touchKeys.add(key);
        else touchKeys.delete(key);
      }
    };
  } catch (error) {
    dispose();
    signal.removeEventListener('abort', dispose);
    throw error;
  }
}

function fitModel(
  THREE: ThreeModule,
  root: InstanceType<ThreeModule['Group']>,
  camera: InstanceType<ThreeModule['PerspectiveCamera']>,
  controls: InstanceType<OrbitControlsModule['OrbitControls']>
): { maxDim: number; reset: () => void } {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    const noop = () => {
      // no-op
    };
    return { maxDim: 1, reset: noop };
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  root.position.sub(center);

  const minNear = Math.max(maxDim / 100000, 0.0001);
  camera.near = minNear;
  camera.far = Math.max(maxDim * 100, 1000);
  camera.updateProjectionMatrix();

  const fitHeightDistance = maxDim / Math.max(2 * Math.tan((camera.fov * Math.PI) / 360), 0.0001);
  const distance = Math.max(fitHeightDistance * 1.6, maxDim * 1.2, 0.5);

  const reset = () => {
    camera.position.set(distance, distance * 0.45, distance);
    controls.target.set(0, 0, 0);
    controls.minDistance = Math.max(maxDim / 200, 0.001);
    controls.maxDistance = Math.max(maxDim * 50, 5);
    controls.update();
  };

  reset();
  return { maxDim, reset };
}

function adaptGrid(
  THREE: ThreeModule,
  grid: InstanceType<ThreeModule['GridHelper']>,
  maxDim: number
): void {
  const gridSize = Math.max(nextPowerOfTen(maxDim * 2), 1);
  const divisions = clamp(Math.round(gridSize / Math.max(maxDim / 8, 0.1)), 8, 120);
  const replacement = new THREE.GridHelper(gridSize, divisions, 0x475569, 0x1e293b);
  grid.parent?.add(replacement);
  grid.parent?.remove(grid);
}

function setWireframe(root: InstanceType<ThreeModule['Group']>, enabled: boolean): void {
  root.traverse(node => {
    const mesh = node as {
      isMesh?: boolean;
      material?: { wireframe?: boolean } | { wireframe?: boolean }[];
    };
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        if (typeof material.wireframe === 'boolean') {
          material.wireframe = enabled;
        }
      }
      return;
    }

    if (typeof mesh.material.wireframe === 'boolean') {
      mesh.material.wireframe = enabled;
    }
  });
}

function nextPowerOfTen(value: number): number {
  const safe = Math.max(value, 0.1);
  const exponent = Math.ceil(Math.log10(safe));
  return Math.pow(10, exponent);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseModelRotation(value: string | null): ModelRotation {
  if (!value) {
    return DEFAULT_MODEL_ROTATION;
  }

  const [x, y, z] = value.split(',').map(part => Number(part.trim()));
  return {
    x: Number.isFinite(x) ? x : DEFAULT_MODEL_ROTATION.x,
    y: Number.isFinite(y) ? y : DEFAULT_MODEL_ROTATION.y,
    z: Number.isFinite(z) ? z : DEFAULT_MODEL_ROTATION.z
  };
}

