'use client';

import dynamic from 'next/dynamic';
import type { RegionStat } from './energySources';

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
  regions,
}: {
  selectedRegion: string,
  regions?: RegionStat[],
}) {
  return <MapComponent selectedRegion={selectedRegion} regions={regions} />;
}
