/**
 * Turns a modular design (building, vehicle, spaceship) into a 3D model. Used by the editors, the
 * Civilization Stage's cities and traffic, the Space Stage and the Sporepedia turntable, so a design
 * looks the same everywhere. Geometry is shared between models; each model has its own materials so
 * colours can differ.
 */
import * as THREE from "three";
import { partOf } from "./modular.js";

const geoCache = new Map();
function geometryFor(def) {
  const key = def.shape + ":" + def.size.join(",") + ":" + (def.rx || 0) + ":" + def.id;
  if (geoCache.has(key)) return geoCache.get(key);
  const [w, h, d] = def.size;
  let g;
  switch (def.shape) {
    case "box":
      g = new THREE.BoxGeometry(w, h, d);
      break;
    case "cyl":
      g = new THREE.CylinderGeometry(w / 2, w / 2, h, 14);
      break;
    case "cone":
      g = new THREE.ConeGeometry(w / 2, h, 14);
      break;
    case "sphere":
      g = new THREE.SphereGeometry(w / 2, 14, 10).scale(1, h / w, d / w);
      break;
    case "dome":
      g = new THREE.SphereGeometry(w / 2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, (h * 2) / w, d / w);
      break;
    case "torus":
      g = new THREE.TorusGeometry(w / 2 - Math.max(0.06, d / 2), Math.max(0.06, d / 2), 8, 24, def.id === "arch" ? Math.PI : Math.PI * 2);
      break;
    case "ring":
      g = new THREE.TorusGeometry(w / 2 - 0.15, 0.15, 8, 28);
      break;
    case "wheel":
      g = new THREE.CylinderGeometry(w / 2, w / 2, d, 16).rotateZ(Math.PI / 2);
      break;
    case "prism":
      // A roof: a triangular prism running along x.
      g = new THREE.CylinderGeometry(1, 1, 1, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).scale(w, (h / 1.5) * 1, d / 1.73).translate(0, h * 0.17, 0);
      break;
    case "wing":
      g = new THREE.BoxGeometry(w, h, d);
      // Taper the trailing tips.
      {
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) > w * 0.4 && pos.getZ(i) > 0) pos.setZ(i, pos.getZ(i) * 0.35);
        g.computeVertexNormals();
      }
      break;
    case "capsule": {
      // Long axis: depth when the part lies down (rx), else height.
      const len = def.rx ? d : h,
        r = Math.min(w, def.rx ? h : d) / 2;
      g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14).scale(w / (2 * r), 1, (def.rx ? h : d) / (2 * r));
      break;
    }
    case "disc":
      g = new THREE.CylinderGeometry(w / 2, w * 0.42, h, 28);
      break;
    default:
      g = new THREE.BoxGeometry(w, h, d);
  }
  if (def.rx) g.rotateX(def.rx);
  geoCache.set(key, g);
  return g;
}

/** A part's size at scale 1 as it sits in a design (after any built-in tilt), for stacking parts. */
export function partExtent(kind, id) {
  const def = partOf(kind, id);
  if (!def) return new THREE.Vector3(1, 1, 1);
  const g = geometryFor(def);
  if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox.getSize(new THREE.Vector3());
}

/** Materials for one design's colours. */
export function designMaterials(colors) {
  return {
    base: new THREE.MeshStandardMaterial({ color: colors.base, roughness: 0.75, flatShading: true }),
    accent: new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.6, flatShading: true }),
    trim: new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.85, flatShading: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.35, metalness: 0.6, flatShading: true }),
  };
}

/**
 * Build a design's model.
 * @param {object} design  a validated modular design
 * @param {{ shadows?:boolean, materials?:object }} [opts]  materials: a shared set from designMaterials (not disposed here)
 * @returns {{ root:THREE.Group, parts:{mesh:THREE.Mesh, mirror:THREE.Mesh|null, index:number}[], materials:object, setColors:(c:object)=>void, dispose:()=>void }}
 */
export function buildDesignMesh(design, { shadows = false, materials: shared = null } = {}) {
  const root = new THREE.Group();
  // Many models in one colour scheme (a city's buildings, a fleet) can share one set of materials.
  const materials = shared || designMaterials(design.colors);
  const parts = [];
  design.parts.forEach((p, index) => {
    const def = partOf(design.kind, p.id);
    if (!def) return;
    const geo = geometryFor(def);
    const make = (sign) => {
      const m = new THREE.Mesh(geo, materials[def.paint]);
      m.position.set(p.x * sign, p.y, p.z);
      m.rotation.y = (p.ry || 0) * sign;
      m.scale.setScalar(p.s || 1);
      m.castShadow = shadows;
      m.userData.partIndex = index;
      root.add(m);
      return m;
    };
    parts.push({ mesh: make(1), mirror: p.mirror ? make(-1) : null, index });
  });
  return {
    root,
    parts,
    materials,
    setColors(c) {
      materials.base.color.set(c.base);
      materials.accent.color.set(c.accent);
      materials.trim.color.set(c.trim);
    },
    dispose() {
      if (!shared) Object.values(materials).forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}

/** The design's size, for framing it in a view or scaling it on a map. */
export function designBounds(model) {
  const box = new THREE.Box3().setFromObject(model.root);
  return { box, size: box.getSize(new THREE.Vector3()), centre: box.getCenter(new THREE.Vector3()) };
}
