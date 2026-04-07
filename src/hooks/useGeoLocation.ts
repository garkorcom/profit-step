import { useState } from 'react';

export interface GeoLocation {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
}

interface UseGeoLocationReturn {
    location: GeoLocation | null;
    error: string | null;
    loading: boolean;
    getLocation: () => Promise<GeoLocation>;
    calculateDistance: (target: { lat: number; lng: number }) => number | null;
}

export const useGeoLocation = (): UseGeoLocationReturn => {
    const [location, setLocation] = useState<GeoLocation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Haversine formula to calculate distance in meters
    const calculateDistance = (target: { lat: number; lng: number }): number | null => {
        if (!location) return null;

        const R = 6371e3; // Earth radius in meters
        const φ1 = (location.lat * Math.PI) / 180;
        const φ2 = (target.lat * Math.PI) / 180;
        const Δφ = ((target.lat - location.lat) * Math.PI) / 180;
        const Δλ = ((target.lng - location.lng) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distance in meters
    };

    const getLocation = (): Promise<GeoLocation> => {
        setLoading(true);
        setError(null);

        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                const err = 'Geolocation is not supported by your browser';
                setError(err);
                setLoading(false);
                reject(new Error(err));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const newLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp,
                    };
                    setLocation(newLocation);
                    setLoading(false);
                    resolve(newLocation);
                },
                (err) => {
                    let errorMessage = 'Failed to retrieve location';
                    switch (err.code) {
                        case err.PERMISSION_DENIED:
                            errorMessage = 'Location access denied. Please enable GPS.';
                            break;
                        case err.POSITION_UNAVAILABLE:
                            errorMessage = 'GPS signal lost. Please move to an open area.';
                            break;
                        case err.TIMEOUT:
                            errorMessage = 'GPS timeout. Try again.';
                            break;
                    }
                    setError(errorMessage);
                    setLoading(false);
                    reject(new Error(errorMessage));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 15000, // Increased timeout for better accuracy
                    maximumAge: 0,
                }
            );
        });
    };

    return { location, error, loading, getLocation, calculateDistance };
};
