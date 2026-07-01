'use client';

import React, { memo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface Region {
  name: string;
  coords: [number, number];
}

const REGIONS: Region[] = [
  { name: "서울", coords: [37.5665, 126.9780] },
  { name: "부산", coords: [35.1796, 129.0756] },
  { name: "대구", coords: [35.8714, 128.6014] },
  { name: "인천", coords: [37.4563, 126.7052] },
  { name: "광주", coords: [35.1595, 126.8526] },
  { name: "대전", coords: [36.3504, 127.3845] },
  { name: "울산", coords: [35.5384, 129.3114] },
  { name: "세종", coords: [36.4801, 127.2892] },
  { name: "경기", coords: [37.2636, 127.0286] },
  { name: "강원", coords: [37.8228, 128.1555] },
  { name: "충북", coords: [36.6353, 127.4913] },
  { name: "충남", coords: [36.6588, 126.6728] },
  { name: "전북", coords: [35.8242, 127.1480] },
  { name: "전남", coords: [34.8679, 126.9910] },
  { name: "경북", coords: [36.5760, 128.5056] },
  { name: "경남", coords: [35.2376, 128.6911] },
  { name: "제주", coords: [33.4996, 126.5312] },
];

const MapComponent = ({ 
  selectedRegion, 
  onRegionChange 
}: { 
  selectedRegion: string, 
  onRegionChange: (name: string) => void 
}) => {
  return (
    <MapContainer 
      center={[35.9, 127.7]} 
      zoom={7} 
      style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {REGIONS.map((region) => (
        <CircleMarker 
          key={region.name}
          center={region.coords}
          radius={selectedRegion === region.name ? 15 : 10}
          pathOptions={{ 
            fillColor: selectedRegion === region.name ? '#ef4444' : '#2563eb', 
            fillOpacity: 0.7, 
            color: '#ffffff', 
            weight: 2 
          }}
          eventHandlers={{
            click: () => onRegionChange(region.name),
          }}
        >
          <Popup autoPan={false}>
            <div className="text-center">
              <p className="font-bold text-slate-800">{region.name}</p>
              <p className="text-xs text-slate-500">클릭하여 지역 선택</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
};

export default memo(MapComponent);
