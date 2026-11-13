import type { Tuning } from './car';
import type { ModelName } from './assets';

/** Voitures jouables : modèle 3D, caractéristiques affichées (1 à 5) et réglages de conduite */
export interface CarDef {
  id: string;
  name: string;
  tagline: string;
  model: ModelName;
  length: number;
  accent: string;
  stats: { vitesse: number; acceleration: number; maniabilite: number; poids: number };
  tuning: Partial<Tuning>;
}

export const CARS: CarDef[] = [
  {
    id: 'fusee', name: 'Fusée Rouge', tagline: 'La polyvalente : vive et facile à driver',
    model: 'car', length: 5.3, accent: '#e23b3b',
    stats: { vitesse: 3, acceleration: 4, maniabilite: 5, poids: 2 },
    tuning: {},
  },
  {
    id: 'challenger', name: 'Challenger Bleue', tagline: 'La muscle car : la plus rapide en ligne droite',
    model: 'car_challenger', length: 5.9, accent: '#2f7fd6',
    stats: { vitesse: 5, acceleration: 3, maniabilite: 3, poids: 3 },
    tuning: {
      maxSpeed: 81, boostSpeed: 112, accel: 100, steerRate: 2.4, grip: 11.5, driftGrip: 3.0,
      halfW: 1.35, halfL: 2.6, radius: 2.1,
    },
  },
  {
    id: 'monster', name: 'Monster Fluo', tagline: 'Le monstre : grimpe partout et vole loin',
    model: 'car_monster', length: 6.2, accent: '#b6f03a',
    stats: { vitesse: 2, acceleration: 5, maniabilite: 3, poids: 5 },
    tuning: {
      maxSpeed: 66, boostSpeed: 96, accel: 140, steerRate: 2.5, grip: 12, driftGrip: 3.6,
      milkGrip: 2.4, sugarFactor: 0.75, gravity: 140, launchBoost: 2.1,
      stepH: 3.2, halfW: 2.2, halfL: 2.9, radius: 2.6,
    },
  },
];
