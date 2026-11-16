// Terminal 9, the Breakwater freight yard: one original map, axis-aligned so
// collision, sightlines and bot routes all stay exact. Three lanes (north,
// mid, south) join two bomb sites: A in the warehouse, B on the crane dock.
// Boxes are [cx, cz, w, d, h, material, y0]; the waypoint graph sits on the
// open ground between them.
import * as THREE from 'three';
import { boxCollider } from './physics.js';
import { siteDecalTexture } from './palette.js';

export const MAP_HALF = { x: 30, z: 22 };

export const SITES = {
  A: { letter: 'A', name: 'Warehouse', x: -18, z: -15, halfX: 4.5, halfZ: 4.5 },
  B: { letter: 'B', name: 'Crane Dock', x: 17, z: 14.5, halfX: 4.5, halfZ: 4 },
};

export const SPAWNS = {
  atk: [
    [-27.5, -4], [-27.5, 4], [-25.5, -5], [-25.5, 5], [-28.5, 0],
  ],
  def: [
    [27.5, -4], [27.5, 4], [25.5, -5], [25.5, 5], [28.5, 0],
  ],
};

// Waypoint graph: nodes on open ground, edges between neighbours with a clear
// line. Bots path with BFS over this graph.
export const WAYPOINTS = [
  [-26, 0], [-22, -6], [-22, 6], [-16, -6], [-16, 6], [-18, -6.5], [-18, -11],
  [-18, -15], [-13, -15], [-7, -15], [-7, -6], [-7, 6], [-7, -16], [2, -16],
  [10, -16], [18, -16], [22, -6], [22, 6], [26, 0], [16, -6], [16, 6],
  [8, -6], [8, 6], [-2, 0], [6, 0], [12, 10], [17, 11], [17, 15],
  [22, 15], [10, 16], [2, 16], [-8, 16], [-16, 12], [-2, -8], [2, 8],
];
const EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [3, 10], [4, 11], [5, 6], [6, 7],
  [6, 8], [8, 9], [9, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 18],
  [17, 18], [16, 19], [17, 20], [19, 21], [20, 22], [21, 24], [22, 24],
  [23, 24], [10, 23], [11, 23], [10, 33], [21, 33], [11, 34], [22, 34],
  [19, 14], [20, 29], [25, 26], [26, 27], [27, 28], [25, 29], [29, 30],
  [30, 31], [31, 32], [32, 4], [25, 22], [28, 17], [9, 10], [24, 33],
];
export const ADJACENT = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  ADJACENT[a].push(b);
  ADJACENT[b].push(a);
}

// Defender hold spots: waypoint, facing yaw, and whether to crouch behind cover.
export const HOLD_SPOTS = [
  { node: 7, yaw: Math.PI, crouch: false },
  { node: 8, yaw: -Math.PI / 2, crouch: false },
  { node: 27, yaw: Math.PI / 2, crouch: true },
  { node: 26, yaw: 0, crouch: false },
  { node: 24, yaw: Math.PI / 2, crouch: false },
];

const BOXES = [
  // Perimeter walls.
  [0, -22.5, 62, 1, 4.5, 'concrete'], [0, 22.5, 62, 1, 4.5, 'concrete'],
  [-30.5, 0, 1, 46, 4.5, 'concrete'], [30.5, 0, 1, 46, 4.5, 'concrete'],
  // Spawn exit walls with two gaps each.
  [-22.5, -15.5, 1, 13, 3.6, 'metal'], [-22.5, 15.5, 1, 13, 3.6, 'metal'],
  [-22.5, 0, 1, 6, 3.6, 'metal'],
  [22.5, -15.5, 1, 13, 3.6, 'metal'], [22.5, 15.5, 1, 13, 3.6, 'metal'],
  [22.5, 0, 1, 6, 3.6, 'metal'],
  // Warehouse (site A): east wall with a door, south wall with a door.
  [-10, -19, 1, 4, 5, 'concrete'], [-10, -11, 1, 4, 5, 'concrete'],
  [-23, -9, 6, 1, 5, 'concrete'], [-13, -9, 6, 1, 5, 'concrete'],
  [-26, -15, 1, 12, 5, 'concreteDark'],
  // Warehouse interior cover.
  [-21, -18, 2.4, 2.4, 1.2, 'wood'], [-14.5, -18.5, 1.6, 1.6, 1.6, 'wood'],
  [-15, -12, 3, 1.2, 1.1, 'concreteDark'], [-23, -11.5, 1.8, 1.8, 1.1, 'metal'],
  // North lane containers.
  [-4, -16, 6, 2.4, 2.6, 'red'], [6, -16, 6, 2.4, 2.6, 'teal'],
  [16, -18.5, 6, 2.4, 2.6, 'ochre'], [13, -13, 2.4, 2.4, 1.2, 'wood'],
  // South lane containers.
  [-6, 16, 6, 2.4, 2.6, 'blue'], [4, 16, 6, 2.4, 2.6, 'red'],
  [-14, 18.5, 6, 2.4, 2.6, 'teal'], [-11, 12.5, 2.4, 2.4, 1.2, 'wood'],
  // Mid yard cover.
  [-1, -3, 2, 2, 1.2, 'wood'], [2.5, 2.5, 1.5, 1.5, 1.5, 'wood'],
  [5, -4, 6, 2.4, 2.6, 'ochre'], [-5, 4.5, 6, 2.4, 2.6, 'blue'],
  [-2, -6, 3, 0.8, 1.1, 'concreteDark'], [3, 6, 3, 0.8, 1.1, 'concreteDark'],
  // Connector cover (kept off the waypoint lines).
  [-4, -8, 1.6, 1.6, 1.6, 'wood'], [-4, 8, 1.6, 1.6, 1.6, 'wood'],
  [10.5, -8, 1.6, 1.6, 1.6, 'wood'], [10.5, 8, 1.6, 1.6, 1.6, 'wood'],
  // Dock (site B) containers and cover.
  [20, 12, 6, 2.4, 2.6, 'teal'], [20, 17.5, 6, 2.4, 2.6, 'red'],
  [12, 19, 6, 2.4, 2.6, 'blue'], [13.5, 14.5, 1.6, 1.6, 1.6, 'wood'],
  [22, 10.5, 2.4, 1.2, 1.1, 'concreteDark'],
  // Hazard-striped low barriers at lane mouths.
  [-19, -3.5, 4, 0.6, 1, 'hazard'], [19, -3.5, 4, 0.6, 1, 'hazard'],
  [-19, 3.5, 4, 0.6, 1, 'hazard'], [19, 3.5, 4, 0.6, 1, 'hazard'],
];

const BARRELS = [
  [-1, 4], [-18, -4], [-12, 6], [0, -8], [10, 2], [18, -6], [-2, 12],
  [24, -14], [-24, 14], [12, -12], [24, 8], [-26, -10], [8, -19], [-9, 19],
];

const geoCache = new Map();
function boxGeometry(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = new THREE.BoxGeometry(w, h, d);
  // Tile the texture every 3 m per face: BoxGeometry orders faces +x -x +y -y +z -z.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = geo.attributes.uv;
  for (let face = 0; face < 6; face += 1) {
    const [du, dv] = dims[face];
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * (du / 3), uv.getY(i) * (dv / 3));
    }
  }
  geoCache.set(key, geo);
  return geo;
}

export function createWorld(scene, palette) {
  const { materials } = palette;
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  // Ground: one plane, asphalt tiled every 6 m.
  const groundGeo = new THREE.PlaneGeometry(62, 46);
  const groundUv = groundGeo.attributes.uv;
  for (let i = 0; i < groundUv.count; i += 1) {
    groundUv.setXY(i, groundUv.getX(i) * (62 / 6), groundUv.getY(i) * (46 / 6));
  }
  const ground = new THREE.Mesh(groundGeo, materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  function addBox(cx, cz, w, d, h, matKey, y0 = 0) {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d), materials[matKey]);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = h > 0.6;
    mesh.receiveShadow = true;
    mesh.userData.solid = true;
    group.add(mesh);
    shootables.push(mesh);
    colliders.push(boxCollider(cx, cz, w, d, h, y0));
    return mesh;
  }

  for (const [cx, cz, w, d, h, mat] of BOXES) addBox(cx, cz, w, d, h, mat);

  // Barrels: cylinders with an AABB collider each.
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  const barrelMats = [materials.rust, materials.metalDark, materials.teal];
  BARRELS.forEach(([x, z], i) => {
    const mesh = new THREE.Mesh(barrelGeo, barrelMats[i % barrelMats.length]);
    mesh.position.set(x, 0.55, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.solid = true;
    group.add(mesh);
    shootables.push(mesh);
    colliders.push(boxCollider(x, z, 0.9, 0.9, 1.1));
  });

  // The dock crane: two legs, a top beam, a jib and a hanging hook block.
  const craneMat = materials.hazard;
  addBox(13, 11, 1, 1, 8, 'metalDark');
  addBox(13, 17.5, 1, 1, 8, 'metalDark');
  const beam = new THREE.Mesh(boxGeometry(1.4, 1, 9.5), craneMat);
  beam.position.set(13, 8.4, 14.2);
  beam.castShadow = true;
  group.add(beam);
  const jib = new THREE.Mesh(boxGeometry(6, 0.8, 1), craneMat);
  jib.position.set(10, 8.4, 14.2);
  jib.castShadow = true;
  group.add(jib);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), materials.dark);
  cable.position.set(7.5, 6.5, 14.2);
  group.add(cable);
  const hook = new THREE.Mesh(boxGeometry(1.1, 1.1, 1.1), materials.rust);
  hook.position.set(7.5, 4.3, 14.2);
  hook.castShadow = true;
  group.add(hook);

  // Lamp poles: emissive heads; the three real lights are added by main.js.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5, 8);
  const headGeo = new THREE.BoxGeometry(0.7, 0.18, 0.34);
  for (const [x, z] of [[-8, 0], [8, 0], [-18, -15], [17, 14.5], [-26, -16], [26, 16]]) {
    const pole = new THREE.Mesh(poleGeo, materials.metalDark);
    pole.position.set(x, 2.5, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(headGeo, materials.lamp);
    head.position.set(x, 5.05, z);
    group.add(head);
    colliders.push(boxCollider(x, z, 0.3, 0.3, 5));
  }

  // Warehouse window glow: emissive planes on the east wall.
  const winGeo = new THREE.PlaneGeometry(2.2, 1.2);
  for (const z of [-18, -12]) {
    const win = new THREE.Mesh(winGeo, materials.window);
    win.position.set(-9.45, 3.2, z);
    win.rotation.y = Math.PI / 2;
    group.add(win);
  }

  // Site decals: painted letters on the ground, ringed.
  for (const site of Object.values(SITES)) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({
        map: siteDecalTexture(site.letter, site.letter === 'A' ? '#ffb340' : '#38b8a8'),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.03, site.z);
    group.add(decal);
  }

  return { group, colliders, shootables, boxes: BOXES, barrels: BARRELS };
}
