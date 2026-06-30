// Interactive "Editing Results" viewers.
//
// Strategy: a single shared WebGLRenderer (one WebGL context) covers the
// viewport as a fixed, click-through canvas. Each result tile is a normal DOM
// element; every frame we look up its on-screen rectangle and render its scene
// into that region using the viewport/scissor technique. This scales to dozens
// of tiles without exhausting the browser's WebGL context limit.
//
// Geometry is fetched lazily (when a tile nears the viewport) and cached, so
// the ~87 MB of meshes only load progressively as the user scrolls.

import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MANIFEST_URL = '/assets/editing/manifest.json';
const GARMENT_COLOR = 0x4c78d8;
const BODY_COLOR = 0xc9cad0;
const BODY_URL = '/assets/editing/meshes/body.ply';

const loader = new PLYLoader();
const geomCache = new Map(); // url -> Promise<BufferGeometry>

function loadGeometry(url) {
  if (!geomCache.has(url)) {
    geomCache.set(url, new Promise((resolve, reject) => {
      loader.load(url, (geom) => {
        geom.computeVertexNormals();
        resolve(geom);
      }, undefined, reject);
    }));
  }
  return geomCache.get(url);
}

const views = [];            // all registered view descriptors
const viewByElem = new Map();
let renderer, canvas;

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const v = viewByElem.get(entry.target);
    if (v && !v.setupStarted) setupView(v);
    io.unobserve(entry.target);
  }
}, { rootMargin: '300px 0px' });

function registerView(elem, specs) {
  const v = { elem, specs, ready: false, setupStarted: false };
  views.push(v);
  viewByElem.set(elem, v);
  io.observe(elem);
}

function setupView(v) {
  v.setupStarted = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);

  const controls = new OrbitControls(camera, v.elem);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.9;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(1, 1.6, 2.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-1.4, 0.6, -1.6);
  scene.add(fill);

  Promise.all(v.specs.map((s) => loadGeometry(s.url).then((g) => ({ g, s }))))
    .then((items) => {
      const group = new THREE.Group();
      for (const { g, s } of items) {
        const material = new THREE.MeshStandardMaterial({
          color: s.color,
          roughness: 0.85,
          metalness: 0.0,
          side: THREE.DoubleSide,
          transparent: (s.opacity ?? 1) < 1,
          opacity: s.opacity ?? 1,
        });
        const mesh = new THREE.Mesh(g, material);
        if (s.scale) mesh.scale.setScalar(s.scale);
        if (s.translate) mesh.position.add(new THREE.Vector3(...s.translate));
        if (s.translateY) mesh.position.y += s.translateY;
        if (s.translateZ) mesh.position.z += s.translateZ;
        group.add(mesh);
      }
      scene.add(group);
      group.updateMatrixWorld(true);
      frameCamera(camera, controls, group);

      v.scene = scene;
      v.camera = camera;
      v.controls = controls;
      v.ready = true;
    })
    .catch((err) => console.error('Failed to load view meshes', v.specs, err));
}

function frameCamera(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * Math.PI / 180;
  const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

  controls.target.copy(center);
  camera.position.set(center.x, center.y, center.z + dist);
  camera.near = Math.max(dist / 100, 0.001);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  canvas = renderer.domElement;
  Object.assign(canvas.style, {
    position: 'fixed', top: '0', left: '0',
    width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '1',
  });
  document.body.appendChild(canvas);

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);

  // Clear the whole canvas to transparent so scrolled-away tiles leave no trail.
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setScissorTest(true);

  const canvasHeight = canvas.clientHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const v of views) {
    if (!v.ready) continue;
    const r = v.elem.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue; // hidden (e.g. inactive carousel slide)
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;

    const width = r.width;
    const height = r.height;
    const left = r.left;
    const bottom = canvasHeight - r.bottom;

    renderer.setViewport(left, bottom, width, height);
    renderer.setScissor(left, bottom, width, height);
    v.camera.aspect = width / height;
    v.camera.updateProjectionMatrix();
    v.controls.update();
    renderer.render(v.scene, v.camera);
  }
}

function buildCell(title, specs, gridColumn) {
  const cell = document.createElement('div');
  cell.className = 'ev-cell';
  cell.style.gridColumn = gridColumn;
  cell.style.gridRow = '1';

  const view = document.createElement('div');
  view.className = 'ev-view';
  const caption = document.createElement('div');
  caption.className = 'ev-caption';
  caption.textContent = title;

  cell.appendChild(view);
  cell.appendChild(caption);

  if (specs.length) {
    registerView(view, specs);
  } else {
    view.style.display = 'flex';
    view.style.alignItems = 'center';
    view.style.justifyContent = 'center';
    view.style.cursor = 'default';
    const span = document.createElement('span');
    span.textContent = 'Not available';
    span.style.color = '#b5b5b5';
    span.style.fontSize = '.85rem';
    view.appendChild(span);
  }
  return cell;
}

function buildPattern(src, caption, gridColumn) {
  const wrap = document.createElement('div');
  wrap.className = 'ev-pattern';
  wrap.style.gridColumn = gridColumn;
  wrap.style.gridRow = '2';

  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = caption;
    img.loading = 'lazy';
    wrap.appendChild(img);
  }
  const cap = document.createElement('div');
  cap.className = 'ev-pattern-caption';
  cap.textContent = caption;
  wrap.appendChild(cap);
  return wrap;
}

async function build() {
  const root = document.getElementById('editing-results');
  if (!root) return;

  let data;
  try {
    data = await fetch(MANIFEST_URL).then((r) => r.json());
  } catch (err) {
    root.innerHTML = '<p class="has-text-centered has-text-grey">Could not load editing results.</p>';
    console.error(err);
    return;
  }

  // The mean body is in meter-world space. Garment meshes come from different
  // pipelines, so each column needs a transform to land in that frame:
  //   Input (cm) -> scale 0.01 ; GT (cm) -> scale 0.01
  //   Edit (normalized) -> add back the body AABB center that was subtracted
  //   during prediction (self.translation = -body.bounding_box.vertices.mean(0)).
  const EDIT_TRANSLATE = [-0.002153, 0.859951, 0.002558];
  const specsFor = (url, transform) => {
    const specs = [{ url: BODY_URL, color: BODY_COLOR, opacity: 1 }];
    if (url) specs.unshift({ url, color: GARMENT_COLOR, opacity: 1, ...transform });
    return specs;
  };

  // Flatten the manifest into one slide per (example, edit).
  const slidesData = [];
  for (const ex of data) {
    for (const edit of ex.edits) slidesData.push({ ex, edit });
  }
  if (!slidesData.length) return;

  const carousel = document.createElement('div');
  carousel.className = 'ee-carousel';

  const stage = document.createElement('div');
  stage.className = 'ee-stage';

  const slideEls = [];
  for (const { ex, edit } of slidesData) {
    const slide = document.createElement('div');
    slide.className = 'editing-example ee-slide';

    const title = document.createElement('div');
    title.className = 'ee-title';
    title.textContent = edit.caption || `${ex.id} · ${edit.id}`;
    slide.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'ee-sub';
    sub.textContent = `${ex.id} · ${edit.id}`;
    slide.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'editing-grid';
    grid.appendChild(buildCell('Input', specsFor(ex.input, { scale: 0.01 }), '1'));
    grid.appendChild(buildCell('Edit (final step)', specsFor(edit.edited, { translate: EDIT_TRANSLATE }), '2'));
    grid.appendChild(buildCell('GT simulation', specsFor(edit.gt, { scale: 0.01 }), '3'));
    grid.appendChild(buildPattern(edit.initialPattern, 'Initial pattern', '1 / 2'));
    grid.appendChild(buildPattern(edit.editedPattern, 'Edited pattern', '2 / 4'));
    slide.appendChild(grid);

    stage.appendChild(slide);
    slideEls.push(slide);
  }

  const prev = document.createElement('button');
  prev.className = 'ee-nav ee-prev';
  prev.setAttribute('aria-label', 'Previous edit');
  prev.innerHTML = '<span aria-hidden="true">‹</span>';

  const next = document.createElement('button');
  next.className = 'ee-nav ee-next';
  next.setAttribute('aria-label', 'Next edit');
  next.innerHTML = '<span aria-hidden="true">›</span>';

  const row = document.createElement('div');
  row.className = 'ee-row';
  row.appendChild(prev);
  row.appendChild(stage);
  row.appendChild(next);
  carousel.appendChild(row);

  const dots = document.createElement('div');
  dots.className = 'ee-dots';
  const dotEls = slideEls.map((_, i) => {
    const d = document.createElement('button');
    d.className = 'ee-dot';
    d.setAttribute('aria-label', `Go to edit ${i + 1}`);
    d.addEventListener('click', () => show(i));
    dots.appendChild(d);
    return d;
  });
  carousel.appendChild(dots);

  root.appendChild(carousel);

  let current = 0;
  function show(i) {
    current = (i + slideEls.length) % slideEls.length;
    slideEls.forEach((el, idx) => el.classList.toggle('is-active', idx === current));
    dotEls.forEach((el, idx) => el.classList.toggle('is-active', idx === current));
  }
  prev.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  show(0);

  initRenderer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', build);
} else {
  build();
}
