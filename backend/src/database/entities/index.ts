import * as identity from './identity.entities';
import * as location from './location.entities';
import * as patient from './patient.entities';
import * as provider from './provider.entities';
import * as doctor from './doctor.entities';
import * as appointment from './appointment.entities';
import * as clinical from './clinical.entities';
import * as commerce from './commerce.entities';
import * as system from './system.entities';

export * from './enums';
export * from './identity.entities';
export * from './location.entities';
export * from './patient.entities';
export * from './provider.entities';
export * from './doctor.entities';
export * from './appointment.entities';
export * from './clinical.entities';
export * from './commerce.entities';
export * from './system.entities';

const isEntity = (v: unknown) => typeof v === 'function';
export const ALL_ENTITIES = [identity, location, patient, provider, doctor, appointment, clinical, commerce, system]
  .flatMap((m) => Object.values(m))
  .filter(isEntity) as (new (...args: any[]) => unknown)[];
