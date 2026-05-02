import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { supabase } from '../supabaseClient';

/**
 * Find the closest available ambulance driver to the patient's location.
 *
 * Logic:
 * 1. Fetch all driver locations from Supabase.
 * 2. Fetch all active missions to exclude already-assigned drivers.
 * 3. Calculate distance from each free driver to the patient.
 * 4. Return the closest one.
 *
 * @param {{ lat: number, lng: number }} patientLocation
 * @returns {Promise<{ driverId: string, distance: number, lat: number, lng: number } | null>}
 */
export async function findClosestDriver(patientLocation) {
  if (!patientLocation?.lat || !patientLocation?.lng) {
    return null;
  }

  // 1. Get all driver locations
  const { data: drivers, error: driverError } = await supabase
    .from('driver_locations')
    .select('driver_id, lat, lng, updated_at');

  if (driverError || !drivers?.length) {
    return null;
  }

  // 2. Get all active missions to find busy drivers
  const { data: activeMissions, error: missionError } = await supabase
    .from('active_missions')
    .select('driver_id')
    .in('status', ['pending', 'accepted', 'en_route_hospital']);

  const busyDriverIds = new Set(
    (activeMissions || [])
      .filter((m) => m.driver_id)
      .map((m) => m.driver_id),
  );

  // 3. Filter to only free drivers and calculate distances
  const patientPoint = point([patientLocation.lng, patientLocation.lat]);

  const availableDrivers = drivers
    .filter((d) => !busyDriverIds.has(d.driver_id))
    .map((d) => {
      const driverPoint = point([d.lng, d.lat]);
      const km = distance(patientPoint, driverPoint, { units: 'kilometers' });
      return {
        driverId: d.driver_id,
        lat: d.lat,
        lng: d.lng,
        distance: km,
      };
    })
    .sort((a, b) => a.distance - b.distance);

  // 4. Return the closest
  return availableDrivers[0] || null;
}

/**
 * Auto-dispatch: Create a mission and immediately assign the closest driver.
 *
 * @param {{ id: string }} user — The patient's auth user object
 * @param {{ lat: number, lng: number }} patientLocation
 * @param {{ id: string }} hospital — The selected hospital
 * @returns {Promise<{ mission: object, driver: object } | { error: string }>}
 */
export async function autoDispatchMission(user, patientLocation, hospital) {
  if (!user?.id || !patientLocation || !hospital?.id) {
    return { error: 'Missing required dispatch parameters.' };
  }

  // Find closest driver
  const closestDriver = await findClosestDriver(patientLocation);

  // Create mission — assign driver immediately if found, otherwise leave pending
  const missionPayload = {
    patient_id: user.id,
    hospital_id: hospital.id,
    pickup_lat: patientLocation.lat,
    pickup_lng: patientLocation.lng,
    status: closestDriver ? 'accepted' : 'pending',
    driver_id: closestDriver?.driverId || null,
    updated_at: new Date().toISOString(),
  };

  const { data: mission, error: missionError } = await supabase
    .from('active_missions')
    .insert(missionPayload)
    .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, updated_at')
    .single();

  if (missionError) {
    return { error: missionError.message || 'Unable to create emergency mission.' };
  }

  return {
    mission,
    driver: closestDriver,
  };
}
