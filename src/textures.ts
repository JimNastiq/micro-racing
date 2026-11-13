import * as THREE from 'three';

// Petit générateur pseudo-aléatoire déterministe (mêmes textures à chaque chargement)
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** Plateau en bois : lattes horizontales avec veinage */
export function woodTexture(): THREE.CanvasTexture {
  const r = rng(7);
  const S = 2048;
  const t = canvasTex(S, S, (c) => {
    c.scale(S / 1024, S / 1024);
    const planks = 6;
    const ph = 1024 / planks;
    for (let p = 0; p < planks; p++) {
      const base = 150 + r() * 30;
      c.fillStyle = `rgb(${base + 40},${base - 10},${base - 70})`;
      c.fillRect(0, p * ph, 1024, ph);
      // veinage
      for (let g = 0; g < 110; g++) {
        const y0 = p * ph + r() * ph;
        const amp = 2 + r() * 6;
        const freq = 0.004 + r() * 0.01;
        const ph0 = r() * 10;
        c.strokeStyle = `rgba(${90 + r() * 40},${50 + r() * 20},${20},${0.08 + r() * 0.18})`;
        c.lineWidth = 0.6 + r() * 2.2;
        c.beginPath();
        for (let x = 0; x <= 1024; x += 16) {
          const y = y0 + Math.sin(x * freq + ph0) * amp;
          if (x === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
      // nœuds
      for (let k = 0; k < 2; k++) {
        const kx = r() * 1024, ky = p * ph + ph * (0.3 + r() * 0.4);
        const grd = c.createRadialGradient(kx, ky, 1, kx, ky, 14 + r() * 10);
        grd.addColorStop(0, 'rgba(70,35,10,0.6)');
        grd.addColorStop(1, 'rgba(70,35,10,0)');
        c.fillStyle = grd;
        c.beginPath();
        c.ellipse(kx, ky, 30, 10, 0, 0, Math.PI * 2);
        c.fill();
      }
      // joint entre lattes
      c.fillStyle = 'rgba(40,20,5,0.55)';
      c.fillRect(0, p * ph, 1024, 3);
      // joints verticaux décalés
      const jx = r() * 1024;
      c.fillRect(jx, p * ph, 3, ph);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Carrelage du sol (damier crème / terre cuite) */
export function floorTexture(): THREE.CanvasTexture {
  const t = canvasTex(512, 512, (c) => {
    const s = 256;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#c8673f' : '#efe3cc';
        c.fillRect(i * s, j * s, s, s);
      }
    c.strokeStyle = '#8f8473';
    c.lineWidth = 8;
    for (let k = 0; k <= 2; k++) {
      c.beginPath(); c.moveTo(k * s, 0); c.lineTo(k * s, 512); c.stroke();
      c.beginPath(); c.moveTo(0, k * s); c.lineTo(512, k * s); c.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Ligne de départ en damier */
export function checkerTexture(): THREE.CanvasTexture {
  return canvasTex(256, 64, (c) => {
    const s = 32;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
        c.fillRect(i * s, j * s, s, s);
      }
  });
}

/** Paquet de céréales (marque inventée) */
export function cerealTexture(): THREE.CanvasTexture {
  return canvasTex(512, 768, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 768);
    g.addColorStop(0, '#ffcc1a');
    g.addColorStop(1, '#ff8a00');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 768);
    c.fillStyle = '#d62828';
    c.fillRect(0, 60, 512, 190);
    c.fillStyle = '#fff';
    c.font = 'bold 92px Arial Black, Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText('CROUSTI', 256, 160);
    c.font = 'bold 64px Arial Black, Arial, sans-serif';
    c.fillText("MIEL", 256, 230);
    // bol
    c.fillStyle = '#2f6fd6';
    c.beginPath();
    c.ellipse(256, 520, 190, 120, 0, 0, Math.PI);
    c.fill();
    c.fillStyle = '#fff8e8';
    c.beginPath();
    c.ellipse(256, 520, 190, 40, 0, 0, Math.PI * 2);
    c.fill();
    const r = rng(3);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = r() > 0.5 ? '#c9781e' : '#e0a040';
      c.beginPath();
      c.arc(256 + (r() - 0.5) * 320, 500 + (r() - 0.5) * 60, 10 + r() * 8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#7a1010';
    c.font = 'bold 34px Arial, sans-serif';
    c.fillText('Pétales au miel', 256, 330);
  });
}

/** Couverture de livre (tremplin) */
export function bookTexture(): THREE.CanvasTexture {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#2a7f62';
    c.fillRect(0, 0, 512, 512);
    c.fillStyle = '#f4e6c4';
    c.fillRect(40, 40, 432, 432);
    c.fillStyle = '#2a7f62';
    c.font = 'bold 54px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('RECETTES', 256, 200);
    c.font = 'italic 40px Georgia, serif';
    c.fillText('de Mamie', 256, 260);
    c.strokeStyle = '#2a7f62';
    c.lineWidth = 6;
    c.beginPath();
    c.arc(256, 360, 50, 0, Math.PI * 2);
    c.stroke();
  });
}

/** Numéro de course sur le toit */
export function numberTexture(n: number): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(64, 64, 60, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#111';
    c.font = 'bold 84px Arial Black, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), 64, 70);
  });
}

/** Flaque de lait irrégulière (alpha) */
export function puddleTexture(color: string, seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return canvasTex(256, 256, (c) => {
    c.fillStyle = color;
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 60;
      c.beginPath();
      c.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 30 + r() * 40, 0, Math.PI * 2);
      c.fill();
    }
    // petites gouttes
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      const d = 95 + r() * 25;
      c.beginPath();
      c.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + r() * 6, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/** Sucre renversé (grains) */
export function sugarTexture(): THREE.CanvasTexture {
  const r = rng(11);
  return canvasTex(256, 256, (c) => {
    for (let i = 0; i < 2600; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.7) * 120;
      c.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
      c.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + r() * 2, 2 + r() * 2);
    }
  });
}

/** Grain du tapis de route (mousse) */
export function roadTexture(): THREE.CanvasTexture {
  const r = rng(31);
  const t = canvasTex(512, 512, (c) => {
    c.fillStyle = '#5b6270';
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const v = 70 + r() * 60;
      c.fillStyle = `rgba(${v},${v + 4},${v + 14},${0.25 + r() * 0.35})`;
      c.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Revêtement de route propre : asphalte fin, bordures blanches, pointillés jaunes réguliers.
 *  u = travers (0 → 1), v = longueur (une texture = 2 tirets + 2 espaces) */
export function asphaltTexture(): THREE.CanvasTexture {
  const r = rng(77);
  const W = 1024, H = 2048;
  const t = canvasTex(W, H, (c) => {
    c.fillStyle = '#4b4f57';
    c.fillRect(0, 0, W, H);
    // grain de l'asphalte
    for (let i = 0; i < 90000; i++) {
      const v = 45 + r() * 95;
      c.fillStyle = `rgba(${v},${v + 2},${v + 8},${0.3 + r() * 0.45})`;
      const sz = 1 + r() * 2.5;
      c.fillRect(r() * W, r() * H, sz, sz);
    }
    // légères traces d'usure au centre des voies
    for (const u of [0.28, 0.72]) {
      const g = c.createLinearGradient((u - 0.1) * W, 0, (u + 0.1) * W, 0);
      g.addColorStop(0, 'rgba(20,20,24,0)'); g.addColorStop(0.5, 'rgba(20,20,24,0.18)'); g.addColorStop(1, 'rgba(20,20,24,0)');
      c.fillStyle = g; c.fillRect((u - 0.1) * W, 0, 0.2 * W, H);
    }
    // bordures blanches
    c.fillStyle = '#ffffff';
    c.fillRect(0.045 * W, 0, 0.04 * W, H);
    c.fillRect(0.915 * W, 0, 0.04 * W, H);
    // pointillés jaunes (bords légèrement arrondis)
    c.fillStyle = '#ffd21f';
    const dw = 0.05 * W, x0 = W / 2 - dw / 2;
    for (const y0 of [0.1 * H, 0.6 * H]) {
      const h = 0.3 * H;
      c.beginPath();
      c.roundRect(x0, y0, dw, h, dw / 3);
      c.fill();
    }
    // un peu de grain sur les marquages
    for (let i = 0; i < 12000; i++) {
      c.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      c.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
