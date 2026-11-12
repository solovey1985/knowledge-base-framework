declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/+esm' {
  export * from 'three';
}
declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js/+esm' {
  export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
}
declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/STLLoader.js/+esm' {
  export { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
}
declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/OBJLoader.js/+esm' {
  export { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
}
declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/3MFLoader.js/+esm' {
  export { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
}
declare module 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs' {
  const mermaid: {
    initialize(options: { startOnLoad: boolean; securityLevel: string }): void;
    render(id: string, text: string): Promise<{ svg: string }>;
  };
  export default mermaid;
}
