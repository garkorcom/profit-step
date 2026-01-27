import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet';
import { Box, Typography, Paper, Slider, TextField, Grid } from '@mui/material';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for Leaflet default icon
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface LocationValue {
    latitude: number;
    longitude: number;
    radius: number; // miles
    address?: string; // Optional
}

interface LocationPickerProps {
    value?: LocationValue;
    onChange: (value: LocationValue) => void;
    label?: string;
}

// Click handler component
const MapEvents: React.FC<{ onClick: (lat: number, lng: number) => void }> = ({ onClick }) => {
    useMapEvents({
        click(e) {
            onClick(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
};

const LocationPicker: React.FC<LocationPickerProps> = ({ value, onChange, label = "Work Location" }) => {
    // Default to Miami (generic center)
    const defaultCenter: [number, number] = [25.7617, -80.1918];

    // Initialize center from value if present
    const [center] = useState<[number, number]>(
        value && value.latitude ? [value.latitude, value.longitude] : defaultCenter
    );

    const handleMapClick = (lat: number, lng: number) => {
        onChange({
            latitude: lat,
            longitude: lng,
            radius: value?.radius || 5, // Default 5 miles
            address: value?.address
        });
    };

    const handleRadiusChange = (event: Event, newValue: number | number[]) => {
        if (!value) return;
        onChange({
            ...value,
            radius: newValue as number
        });
    };

    const milesToMeters = (miles: number) => miles * 1609.34;

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>{label}</Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
                Click on map to set location. Radius: {value?.radius || 5} miles.
            </Typography>

            <Box sx={{ height: 400, width: '100%', mb: 2, position: 'relative' }}>
                <MapContainer
                    center={center}
                    zoom={10}
                    style={{ height: '100%', width: '100%', borderRadius: '8px' }}
                >
                    <TileLayer
                        attribution='&copy; OpenStreetMap'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapEvents onClick={handleMapClick} />

                    {value && value.latitude && (
                        <>
                            <Marker position={[value.latitude, value.longitude]} />
                            <Circle
                                center={[value.latitude, value.longitude]}
                                radius={milesToMeters(value.radius)}
                                pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                            />
                        </>
                    )}
                </MapContainer>
            </Box>

            {value && (
                <Grid container spacing={2} alignItems="center">
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography gutterBottom>Geofence Radius (Miles)</Typography>
                        <Slider
                            value={value.radius}
                            onChange={handleRadiusChange}
                            valueLabelDisplay="auto"
                            step={0.5}
                            marks
                            min={0.5}
                            max={20}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="body2">
                            Lat: {value.latitude.toFixed(4)}, Lng: {value.longitude.toFixed(4)}
                        </Typography>
                    </Grid>
                </Grid>
            )}
        </Paper>
    );
};

export default LocationPicker;
