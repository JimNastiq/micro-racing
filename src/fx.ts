import * as THREE from 'three';

/** Système de particules low-poly (cubes instanciés) */
export class Particles {
  private mesh: THREE.InstancedMesh;
  private n: number;
  private pos: Float32Array; private vel: Float32Array;
  private life: Float32Array; private max: Float32Array;
  private size0: Float32Array; private size1: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, n = 500) {
    this.n = n;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n); this.size1 = new Float32Array(n); this.grav = new Float32Array(n);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, this.c.set(0xffffff)); }
    scene.add(this.mesh);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.ColorRepresentation, life: number, s0: number, s1: number, grav = 0) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life; this.max[i] = life;
    this.size0[i] = s0; this.size1[i] = s1; this.grav[i] = grav;
    this.mesh.setColorAt(i, this.c.set(color));
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= 1 - 2 * dt; this.vel[k + 2] *= 1 - 2 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      const sz = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.e.set(i * 1.3 + t * 4, i * 0.7 + t * 3, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
