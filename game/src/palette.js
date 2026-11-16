// The look: a freight terminal at dusk. One palette, procedural canvas
// textures (no image assets), shared materials. Every mesh in the map draws
// from this module, so the scene reads as one place.
import * as THREE from 'three';

export const PALETTE = {
  skyTop: 0x1a2142,
  skyMid: 0x59455f,
  skyHorizon: 0xe07a3f,
  fog: 0x2b2636,
  ground: 0x3b3a3e,
  concrete: 0x8f9296,
  concreteDark: 0x6b6e72,
  metal: 0x4b5058,
  metalDark: 0x33373d,
  rust: 0x8a4a28,
  wood: 0x9a744a,
  containerTeal: 0x2e6f6a,
  containerRed: 0xa34a2e,
  containerOchre: 0xc08a2e,
  containerBlue: 0x3a5a8a,
  hazard: 0xd8a020,
  lampWarm: 0xffc37a,
  accent: 0xffb340,
  atk: 0xf0a830,
  def: 0x38b8a8,
  ink: 0xe9e6df,
};

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx, size, base, flecks, n, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = flecks[i % flecks.length];
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

function makeTextures() {
  const asphalt = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#3b3a3e', ['#454449', '#323135', '#4c4b50'], 2600, 0.5);
    ctx.strokeStyle = 'rgba(20,20,24,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k += 1) {
        x += (Math.random() - 0.5) * 60;
        y += (Math.random() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  const concrete = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#8f9296', ['#9a9da1', '#84878b', '#7c7f83'], 2200, 0.4);
    ctx.fillStyle = 'rgba(60,60,64,0.16)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(Math.random() * s, Math.random() * s, 40 + Math.random() * 60, 20 + Math.random() * 40);
    ctx.strokeStyle = 'rgba(50,50,54,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
  const corrugated = (base, dark, light) =>
    canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 16) {
        ctx.fillStyle = dark;
        ctx.fillRect(x, 0, 5, s);
        ctx.fillStyle = light;
        ctx.fillRect(x + 11, 0, 3, s);
      }
      ctx.fillStyle = 'rgba(90,50,25,0.25)';
      for (let i = 0; i < 8; i += 1) ctx.fillRect(Math.random() * s, Math.random() * s, 3, 30 + Math.random() * 60);
    });
  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8a020';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#26262a';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, s);
      ctx.closePath();
      ctx.fill();
    }
  });
  const wood = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#9a744a';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 42) {
      ctx.fillStyle = 'rgba(60,40,20,0.45)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(255,230,180,0.12)';
      ctx.fillRect(0, y + 3, s, 2);
      for (let i = 0; i < 12; i += 1) {
        ctx.fillStyle = 'rgba(70,45,20,0.25)';
        ctx.fillRect(Math.random() * s, y + 5 + Math.random() * 34, 20 + Math.random() * 50, 1);
      }
    }
  });
  const metal = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#4b5058', ['#565b63', '#41464d'], 1400, 0.4);
    ctx.strokeStyle = 'rgba(20,22,26,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.fillStyle = '#2c2f34';
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return { asphalt, concrete, corrugated, hazard, wood, metal };
}

export function createPalette() {
  const tex = makeTextures();
  const std = (map, color, roughness = 0.9, metalness = 0.05) =>
    new THREE.MeshStandardMaterial({ map: map ?? null, color, roughness, metalness });
  const materials = {
    ground: std(tex.asphalt, 0xffffff, 0.96),
    concrete: std(tex.concrete, 0xffffff, 0.92),
    concreteDark: std(tex.concrete, 0x9a9da2, 0.95),
    metal: std(tex.metal, 0xffffff, 0.6, 0.55),
    metalDark: std(tex.metal, 0x8a8f96, 0.65, 0.5),
    rust: std(tex.metal, 0xb0703f, 0.8, 0.3),
    wood: std(tex.wood, 0xffffff, 0.85),
    hazard: std(tex.hazard, 0xffffff, 0.8),
    teal: std(tex.corrugated('#2e6f6a', '#245954', '#3d857f'), 0xffffff, 0.7, 0.35),
    red: std(tex.corrugated('#a34a2e', '#83391f', '#b95c3c'), 0xffffff, 0.7, 0.35),
    ochre: std(tex.corrugated('#c08a2e', '#9c6f20', '#d09c3c'), 0xffffff, 0.7, 0.35),
    blue: std(tex.corrugated('#3a5a8a', '#2c4670', '#4a6c9e'), 0xffffff, 0.7, 0.35),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff2dd, emissive: PALETTE.lampWarm, emissiveIntensity: 2.2 }),
    window: new THREE.MeshStandardMaterial({ color: 0x2a2f3a, emissive: 0xffb85c, emissiveIntensity: 0.9, roughness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.9 }),
    atkCloth: new THREE.MeshStandardMaterial({ color: 0x6e5a33, roughness: 0.9 }),
    atkGear: new THREE.MeshStandardMaterial({ color: PALETTE.atk, roughness: 0.6, emissive: PALETTE.atk, emissiveIntensity: 0.25 }),
    defCloth: new THREE.MeshStandardMaterial({ color: 0x33555c, roughness: 0.9 }),
    defGear: new THREE.MeshStandardMaterial({ color: PALETTE.def, roughness: 0.6, emissive: PALETTE.def, emissiveIntensity: 0.25 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.7 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x4a3421, roughness: 0.85 }),
  };
  return { textures: tex, materials };
}

// A gradient dome for the dusk sky: three bands, warm at the horizon, with a
// faint sun glow toward the west. One draw call, no texture.
export function createSkyDome() {
  const geo = new THREE.SphereGeometry(220, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      mid: { value: new THREE.Color(PALETTE.skyMid) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vPos; uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;',
      'void main() {',
      '  float h = normalize(vPos).y;',
      '  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));',
      '  col = mix(col, top, smoothstep(0.18, 0.6, h));',
      '  float sun = pow(max(dot(normalize(vPos), normalize(vec3(-0.8, 0.08, -0.35))), 0.0), 24.0);',
      '  col += vec3(1.0, 0.55, 0.25) * sun * 0.7;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  return dome;
}

// A flat letter decal for a bomb site, drawn on canvas: big letter, ring, glow.
export function siteDecalTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 134);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
