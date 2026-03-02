export interface Coordinates {
    latitude: number;
    longitude: number;
}

const EARTH_RADIUS_M = 6371e3; // metres

/**
 * Calculates the Haversine distance between two coordinates in meters.
 */
export function getDistanceMeters(coord1: Coordinates, coord2: Coordinates): number {
    const lat1 = (coord1.latitude * Math.PI) / 180;
    const lat2 = (coord2.latitude * Math.PI) / 180;
    const deltaLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const deltaLng = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_M * c;
}

/**
 * Calculates a destination point given a starting point, distance (meters), and bearing (degrees).
 */
export function getDestinationPoint(
    start: Coordinates,
    distanceMeters: number,
    bearingDegrees: number
): Coordinates {
    const δ = distanceMeters / EARTH_RADIUS_M;
    const θ = (bearingDegrees * Math.PI) / 180;

    const φ1 = (start.latitude * Math.PI) / 180;
    const λ1 = (start.longitude * Math.PI) / 180;

    const φ2 = Math.asin(
        Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );

    const λ2 =
        λ1 +
        Math.atan2(
            Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
            Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
        );

    return {
        latitude: (φ2 * 180) / Math.PI,
        longitude: (λ2 * 180) / Math.PI,
    };
}

/**
 * Generates a random spawn point relative to a user location between minDistance and maxDistance
 */
export function generateRandomSpawn(
    userCoord: Coordinates,
    minDistanceM: number,
    maxDistanceM: number
): Coordinates {
    const distance = minDistanceM + Math.random() * (maxDistanceM - minDistanceM);
    const bearing = Math.random() * 360;
    return getDestinationPoint(userCoord, distance, bearing);
}
