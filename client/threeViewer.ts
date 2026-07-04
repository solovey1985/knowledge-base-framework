type ThreeModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/+esm');
type OrbitControlsModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js/+esm');
type STLLoaderModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/STLLoader.js/+esm');
type OBJLoaderModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/OBJLoader.js/+esm');

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

const DEFAULT_BACKGROUND_COLOR = '#ссс';
const DEFAULT_MODEL_ROTATION: ModelRotation = { x: 0, y: 0, z: 0 };

let dependenciesLoader: Promise<ThreeDeps> | null = null;

function loadDependencies(): Promise<ThreeDeps> {
  if (!dependenciesLoader) {
    dependenciesLoader = Promise.all([
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/+esm'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js/+esm'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/STLLoader.js/+esm'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/OBJLoader.js/+esm')
    ]).then(([THREE, orbit, stl, obj]) => ({
      THREE,
      OrbitControls: orbit.OrbitControls,
      STLLoader: stl.STLLoader,
      OBJLoader: obj.OBJLoader
    }));
  }
  return dependenciesLoader;
}

export function initThreeViewer(): void {
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-kb-3d-viewer]'));
  if (hosts.length === 0) {
    return;
  }

  hosts.forEach(host => {
    bootViewer(host).catch(error => {
      setStatus(host, `Failed to load preview: ${String(error)}`);
    });
  });
}

async function bootViewer(host: HTMLElement): Promise<void> {
  const modelUrl = host.getAttribute('data-model-url') || '';
  const modelFormat = (host.getAttribute('data-model-format') || '').toLowerCase();
  const backgroundColor = host.getAttribute('data-background-color') || DEFAULT_BACKGROUND_COLOR;
  const modelRotation = parseModelRotation(host.getAttribute('data-model-rotation'));
  if (!modelUrl || !modelFormat) {
    setStatus(host, 'Model path is missing.');
    return;
  }

  if (modelFormat !== 'stl' && modelFormat !== 'obj') {
    setStatus(host, `Preview for .${modelFormat} is not supported yet.`);
    return;
  }

  const { THREE, OrbitControls, STLLoader, OBJLoader } = await loadDependencies();

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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.95));
  const directional = new THREE.DirectionalLight(0xffffff, 1.1);
  directional.position.set(3, 6, 4);
  scene.add(directional);

  const grid = new THREE.GridHelper(20, 20, 0x475569, 0x1e293b);
  scene.add(grid);

  const root = new THREE.Group();
  root.rotation.set(
    THREE.MathUtils.degToRad(modelRotation.x),
    THREE.MathUtils.degToRad(modelRotation.y),
    THREE.MathUtils.degToRad(modelRotation.z)
  );
  scene.add(root);

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
    const object = await loader.loadAsync(modelUrl);
    object.traverse(node => {
      if ((node as { isMesh?: boolean }).isMesh) {
        const mesh = node as { material: unknown };
        if (!mesh.material) {
          mesh.material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.08, roughness: 0.75 });
        }
      }
    });
    root.add(object);
  }

  const fit = fitModel(THREE, root, camera, controls);
  adaptGrid(THREE, grid, fit.maxDim);
  attachControls(host, root, fit.reset);
  clearStatus(host);

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(host);

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };

  animate();
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

function attachControls(
  host: HTMLElement,
  root: InstanceType<ThreeModule['Group']>,
  resetView: () => void
): void {
  const resetBtn = host.querySelector<HTMLButtonElement>('[data-kb-3d-reset]');
  const wireframeBtn = host.querySelector<HTMLButtonElement>('[data-kb-3d-wireframe]');

  resetBtn?.addEventListener('click', () => {
    resetView();
  });

  if (!wireframeBtn) {
    return;
  }

  let wireframeEnabled = false;
  wireframeBtn.addEventListener('click', () => {
    wireframeEnabled = !wireframeEnabled;
    setWireframe(root, wireframeEnabled);
    wireframeBtn.textContent = wireframeEnabled ? 'Solid' : 'Wireframe';
  });
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

function setStatus(host: HTMLElement, message: string): void {
  const status = host.querySelector<HTMLElement>('[data-kb-3d-status]');
  if (!status) return;
  status.textContent = message;
}

function clearStatus(host: HTMLElement): void {
  const status = host.querySelector<HTMLElement>('[data-kb-3d-status]');
  if (!status) return;
  status.remove();
}
