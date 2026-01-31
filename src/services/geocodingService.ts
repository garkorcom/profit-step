/**
 * Geocoding Service using OpenStreetMap Nominatim (free, no API key required)
 * https://nominatim.org/release-docs/latest/api/Search/
 */

export interface GeocodingResult {
    lat: number;
    lng: number;
    displayName: string;
}

/**
 * Geocode an address string to coordinates
 * @param address - Address string to geocode
 * @returns Coordinates or null if not found
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
    if (!address || address.trim().length < 5) {
        return null;
    }

    try {
        const encodedAddress = encodeURIComponent(address.trim());
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`,
            {
                headers: {
                    'User-Agent': 'ProfitStep CRM/1.0', // Required by Nominatim ToS
                },
            }
        );

        if (!response.ok) {
            console.error('Geocoding API error:', response.status);
            return null;
        }

        const data = await response.json();

        if (data && data.length > 0) {
            const result = data[0];
            return {
                lat: parseFloat(result.lat),
                lng: parseFloat(result.lon),
                displayName: result.display_name,
            };
        }

        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}
