// Projectiles and transient effects: grenades with bounce physics, pooled
// tracers, impact sparks and explosion flashes. Pools are fixed at startup;
// the per-frame updates reuse their buffers and never allocate.
import * as THREE from 'three';
import { pointBoxAxis, segmentBlocked } from './physics.js';
import { range } from './rng.js';

const GRAVITY = 18;
const GRENADE_RADIUS = 0.14;
const MAX_GRENADES = 8;
const MAX_TRACERS = 24;
const MAX_SPARKS = 240;

export function createEffects(scene, colliders) {
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(GRENADE_RADIUS, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < MAX_GRENADES; i += 1) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, owner: null, beeped: 0 });
  }

  // Tracers: one LineSegments pool, two vertices per tracer, faded by age.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerCol = new Float32Array(MAX_TRACERS * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3));
  const tracerMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = new THREE.LineSegments(tracerGeo, tracerMat);
  tracers.frustumCulled = false;
  scene.add(tracers);
  const tracerLife = new Float32Array(MAX_TRACERS);
  let tracerNext = 0;

  // Sparks: one Points pool, positions and velocities in flat arrays.
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkVel = new Float32Array(MAX_SPARKS * 3);
  const sparkLife = new Float32Array(MAX_SPARKS);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc37a, size: 0.09, transparent: true, opacity: 0.95, depthWrite: false });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkNext = 0;

  // One reusable explosion light and shockwave shell.
  const boomLight = new THREE.PointLight(0xff9040, 0, 26, 1.6);
  scene.add(boomLight);
  const boomShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  boomShell.visible = false;
  scene.add(boomShell);
  let boomAge = 99;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function spawnTracer(from, to, bright) {
    const i = tracerNext;
    tracerNext = (tracerNext + 1) % MAX_TRACERS;
    tracerPos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    const c = bright ? 1 : 0.55;
    tracerCol.set([c, c * 0.75, c * 0.4, c, c * 0.75, c * 0.4], i * 6);
    tracerLife[i] = 0.07;
    tracerGeo.attributes.position.needsUpdate = true;
    tracerGeo.attributes.color.needsUpdate = true;
  }

  function spawnSparks(point, count, power) {
    for (let n = 0; n < count; n += 1) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % MAX_SPARKS;
      sparkPos[i * 3] = point.x;
      sparkPos[i * 3 + 1] = point.y;
      sparkPos[i * 3 + 2] = point.z;
      sparkVel[i * 3] = range(-1, 1) * power;
      sparkVel[i * 3 + 1] = range(0.5, 1.6) * power;
      sparkVel[i * 3 + 2] = range(-1, 1) * power;
      sparkLife[i] = range(0.25, 0.5);
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  function explode(g, ctx) {
    const center = g.pos;
    boomLight.position.copy(center).y += 1;
    boomLight.intensity = 60;
    boomShell.position.copy(center);
    boomShell.visible = true;
    boomAge = 0;
    spawnSparks(center, 60, 7);
    ctx.events.push({ kind: 'explosion', pos: center.clone(), by: g.owner });
    const radius = 7.5;
    for (const actor of ctx.actors) {
      if (!actor.alive) continue;
      tmpA.set(actor.pos.x, actor.pos.y + 0.9, actor.pos.z);
      const dist = tmpA.distanceTo(center);
      if (dist > radius) continue;
      tmpB.copy(center);
      if (segmentBlocked(tmpB, tmpA, colliders)) continue;
      const falloff = 1 - (dist / radius) * 0.75;
      ctx.damageActor(actor, Math.round(125 * falloff), 'blast', g.owner);
      // Knockback away from the blast.
      tmpA.sub(center).normalize();
      actor.vel.x += tmpA.x * 6 * falloff;
      actor.vel.z += tmpA.z * 6 * falloff;
      actor.vel.y += 3.5 * falloff;
    }
  }

  return {
    throwGrenade(owner, origin, dir, power) {
      const g = grenades.find((slot) => !slot.active);
      if (!g) return false;
      g.active = true;
      g.owner = owner;
      g.pos.copy(origin);
      g.vel.copy(dir).multiplyScalar(power);
      g.vel.y += 2.2;
      g.fuse = 2.2;
      g.beeped = 0;
      g.mesh.visible = true;
      g.mesh.position.copy(origin);
      return true;
    },
    spawnTracer,
    spawnSparks,
    impact(point, normal) {
      spawnSparks(point, 6, 2.4);
    },
    blood(point) {
      spawnSparks(point, 5, 1.6);
    },
    step(dt, ctx) {
      for (const g of grenades) {
        if (!g.active) continue;
        g.fuse -= dt;
        if (g.fuse <= 0.6 && g.beeped === 0) {
          g.beeped = 1;
          ctx.events.push({ kind: 'grenadeBeep', pos: g.pos.clone() });
        }
        g.vel.y -= GRAVITY * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y < GRENADE_RADIUS) {
          g.pos.y = GRENADE_RADIUS;
          g.vel.y = Math.abs(g.vel.y) * 0.42;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        const hit = pointBoxAxis(g.pos, GRENADE_RADIUS, colliders);
        if (hit) {
          if (hit.axis === 'x') {
            g.pos.x += hit.push * 0.02;
            g.vel.x = -g.vel.x * 0.45;
          } else if (hit.axis === 'y') {
            g.pos.y += hit.push * 0.02;
            g.vel.y = -g.vel.y * 0.45;
          } else {
            g.pos.z += hit.push * 0.02;
            g.vel.z = -g.vel.z * 0.45;
          }
          g.vel.multiplyScalar(0.82);
        }
        g.mesh.position.copy(g.pos);
        g.mesh.rotation.x += dt * 6;
        if (g.fuse <= 0) {
          g.active = false;
          g.mesh.visible = false;
          explode(g, ctx);
        }
      }
      for (let i = 0; i < MAX_TRACERS; i += 1) {
        if (tracerLife[i] <= 0) continue;
        tracerLife[i] -= dt;
        if (tracerLife[i] <= 0) {
          tracerPos.fill(0, i * 6, i * 6 + 6);
          tracerGeo.attributes.position.needsUpdate = true;
        }
      }
      let sparksMoved = false;
      for (let i = 0; i < MAX_SPARKS; i += 1) {
        if (sparkLife[i] <= 0) continue;
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 12 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        if (sparkPos[i * 3 + 1] < 0.02) sparkPos[i * 3 + 1] = 0.02;
        sparksMoved = true;
      }
      if (sparksMoved) sparkGeo.attributes.position.needsUpdate = true;
      if (boomAge < 0.6) {
        boomAge += dt;
        const t = boomAge / 0.6;
        boomLight.intensity = 60 * (1 - t);
        boomShell.scale.setScalar(1 + t * 7);
        boomShell.material.opacity = 0.55 * (1 - t);
        if (t >= 1) boomShell.visible = false;
      } else if (boomLight.intensity > 0) {
        boomLight.intensity = 0;
      }
    },
  };
}
