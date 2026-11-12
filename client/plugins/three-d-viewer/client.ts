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

export interface ViewerControls {
  reset(): void;
  wireframe(enabled: boolean): void;
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

  const { THREE, OrbitControls, STLLoader, OBJLoader } = await loadDependencies();

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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.95));
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
  function dispose() {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls.dispose();
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
      const object = await loader.loadAsync(modelUrl);
      object.traverse(node => {
        if ((node as { isMesh?: boolean }).isMesh) {
          const mesh = node as import('three').Mesh;
          if (!mesh.material) {
            mesh.material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.08, roughness: 0.75 });
          }
        }
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


    observer = new ResizeObserver(() => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    observer.observe(host);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

    animate();
    return { reset: fit.reset, wireframe: enabled => setWireframe(root, enabled) };
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

