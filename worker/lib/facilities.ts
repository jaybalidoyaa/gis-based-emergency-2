import { NCR_HOSPITALS } from './ncrHospitals.js';



export const SUN_VALLEY_CENTER = { lat: 14.48996, lng: 121.03391 };



/** Barangay Emergency Management Office / SVFAR staging base for fire & rescue units. */

export const BEMO_BASE = { lat: 14.48819, lng: 121.037 };



/**

 * Local (Sun Valley / Parañaque ops) facility markers — non-hospital.

 * Hospitals for NCR live in NCR_HOSPITALS (OSM + ops-verified Parañaque).

 */

const LOCAL_FACILITIES = [

  {

    id: 'fac-hall',

    name: 'Barangay Sun Valley Hall / Health Office',

    category: 'Barangay Hall',

    lat: 14.488834,

    lng: 121.032484,

    address: 'Barangay Sun Valley, Parañaque City',

    contactNumber: '(02) 8659-5589',

    operatingHours: 'Barangay office hours',

    verificationSource: 'Ops: hall and barangay health office share this site',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

  {

    id: 'fac-svfar',

    name: 'Barangay Emergency Management Office — SVFAR',

    category: 'Emergency Base',

    lat: 14.48819,

    lng: 121.037,

    address: 'F2QP+8R2 Sampaguita, Manila, 1709 Metro Manila',

    contactNumber: null,

    operatingHours: '24/7 operations',

    verificationSource: 'Ops pin F2QP+8R2 Sun Valley Fire And Rescue Volunteer Group Inc.',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

  {

    id: 'fac-schools',

    name: 'Sun Valley National High School and Elementary School',

    category: 'Evacuation Center',

    lat: 14.489862,

    lng: 121.029294,

    address: 'Elizabeth Avenue / Sta. Ana, Barangay Sun Valley, Parañaque City',

    contactNumber: '(02) 8823-8031',

    operatingHours: null,

    verificationSource: 'Ops coordinates 14.489862, 121.029294',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

  {

    id: 'fac-police-ss7',

    name: 'Sun Valley Police Sub-station (SS7)',

    category: 'Police Station',

    lat: 14.490037,

    lng: 121.032347,

    address: 'F2QJ+XW Parañaque, Metro Manila',

    contactNumber: '(02) 823-0858',

    operatingHours: null,

    verificationSource: 'Ops pin F2QJ+XW',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

  {

    id: 'fac-police-city',

    name: 'Parañaque City Police Station',

    category: 'Police Station',

    lat: 14.486356,

    lng: 120.991313,

    address: 'Parañaque City',

    contactNumber: null,

    operatingHours: null,

    verificationSource: 'Ops coordinates 14.486356, 120.991313',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

  {

    id: 'fac-fire-bfp',

    name: 'BFP Parañaque Central Station',

    category: 'Fire Station',

    lat: 14.486698,

    lng: 120.991275,

    address: 'Parañaque City',

    contactNumber: '(02) 826-9131',

    operatingHours: '24/7',

    verificationSource: 'Ops coordinates 14.486698, 120.991275',

    lastVerifiedAt: '2026-09-05',

    verificationStatus: 'verified',

  },

] as const;



/**

 * Facility markers for map fallback / seed.

 * Local ops pins + full NCR hospital set (OpenStreetMap amenity=hospital).

 */

export const STATIC_FACILITIES = [...LOCAL_FACILITIES, ...NCR_HOSPITALS];

