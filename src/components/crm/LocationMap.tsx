import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Box, Typography, Paper } from '@mui/material';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { WorkSession } from '../../types/timeTracking.types';

// Fix for Leaflet default icon not showing
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface LocationMapProps {
    sessions: WorkSession[];
}

const LocationMap: React.FC<LocationMapProps> = ({ sessions }) => {
    // Filter sessions with location
    const sessionsWithLocation = sessions.filter(s => s.startLocation?.latitude && s.startLocation?.longitude);

    if (sessionsWithLocation.length === 0) {
        return (
            <Paper sx={{ p: 3, textAlign: 'center', height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">
                    No location data available for the selected period.
                </Typography>
            </Paper>
        );
    }

    // Calculate center (average of coords) or default
    const centerLat = sessionsWithLocation.reduce((acc, s) => acc + (s.startLocation?.latitude || 0), 0) / sessionsWithLocation.length;
    const centerLng = sessionsWithLocation.reduce((acc, s) => acc + (s.startLocation?.longitude || 0), 0) / sessionsWithLocation.length;

    return (
        <Paper sx={{ p: 2, height: 450, mb: 4 }}>
            <Typography variant="h6" gutterBottom>Employee Locations (Start of Shift)</Typography>
            <Box sx={{ height: 400, width: '100%' }}>
                <MapContainer
                    center={[centerLat, centerLng]}
                    zoom={10}
                    style={{ height: '100%', width: '100%', borderRadius: '8px' }}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {sessionsWithLocation.map(session => (
                        <Marker
                            key={session.id}
                            position={[session.startLocation!.latitude, session.startLocation!.longitude]}
                        >
                            <Popup>
                                <Typography variant="subtitle2" fontWeight="bold">{session.employeeName}</Typography>
                                <Typography variant="caption" display="block">{session.clientName}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {new Date(session.startTime.seconds * 1000).toLocaleString()}
                                </Typography>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>
            </Box>
        </Paper>
    );
};

export default LocationMap;
