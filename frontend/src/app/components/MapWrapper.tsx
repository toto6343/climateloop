'use client';

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-100 rounded-lg flex items-center justify-center">
      <p className="text-slate-500 font-medium">Loading Map...</p>
    </div>
  ),
});

export default function MapWrapper({ 
  selectedRegion, 
  onRegionChange 
}: { 
  selectedRegion: string, 
  onRegionChange: (name: string) => void 
}) {
  return <MapComponent selectedRegion={selectedRegion} onRegionChange={onRegionChange} />;
}
