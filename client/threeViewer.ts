type ThreeModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js');
type OrbitControlsModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js');
type STLLoaderModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/STLLoader.js');
type OBJLoaderModule = typeof import('https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/OBJLoader.js');

type ThreeDeps = {
  THREE: ThreeModule;
  OrbitControls: OrbitControlsModule['OrbitControls'];
  STLLoader: STLLoaderModule['STLLoader'];
  OBJLoader: OBJLoaderModule['OBJLoader'];
};

let dependenciesLoader: Promise<ThreeDeps> | null = null;

function loadDependencies(): Promise<ThreeDeps> {
  if (!dependenciesLoader) {
    dependenciesLoader = Promise.all([
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/STLLoader.js'),
      import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/OBJLoader.js')
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
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 1000);
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

  fitModel(THREE, root, camera, controls);
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
): void {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const distance = fitHeightDistance * 1.7;

  camera.position.set(center.x + distance, center.y + distance * 0.5, center.z + distance);
  controls.target.copy(center);
  controls.update();
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
