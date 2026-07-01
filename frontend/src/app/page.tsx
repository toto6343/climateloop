'use client';

import React, { useState, useEffect } from 'react';
import MapWrapper from './components/MapWrapper';

interface SimulationResult {
  carbon_emissions: number;
  sustainability_score: number;
  suitability: Record<string, number>;
  ai_message: string;
}

const MIX_LABELS: Record<string, string> = {
  renewable: '재생에너지',
  nuclear: '원자력',
  fossil: '화석연료'
};

import { Sun, Wind, Droplets, Flame, CloudRain, CloudLightning, Snowflake, ShieldAlert } from 'lucide-react';

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  '태양광': <Sun className="w-4 h-4 text-orange-500" />,
  '풍력': <Wind className="w-4 h-4 text-blue-400" />,
  '수력': <Droplets className="w-4 h-4 text-blue-600" />,
  '화력': <Flame className="w-4 h-4 text-red-500" />
};

const WEATHER_SCENARIOS = [
  { id: '맑음', label: '맑음/화창', icon: <Sun className="w-4 h-4 text-orange-500" /> },
  { id: '흐림/비', label: '장마/폭우', icon: <CloudRain className="w-4 h-4 text-slate-500" /> },
  { id: '태풍', label: '태풍/강풍', icon: <CloudLightning className="w-4 h-4 text-amber-500" /> },
  { id: '겨울', label: '한파/겨울', icon: <Snowflake className="w-4 h-4 text-blue-300" /> },
];

interface SimulationResult {
  carbon_emissions: number;
  sustainability_score: number;
  suitability: Record<string, number>;
  ai_message: string;
  grid_stability: string;
}

export default function Home() {
  const [selectedRegion, setSelectedRegion] = useState("서울");
  const [selectedWeather, setSelectedWeather] = useState("맑음");
  const [mix, setMix] = useState({
    renewable: 33.3,
    nuclear: 33.3,
    fossil: 33.4
  });

  const [results, setResults] = useState<SimulationResult | null>(null);

  const handleSliderChange = (type: keyof typeof mix, value: string) => {
    const newValue = parseFloat(value);
    const otherTypes = (Object.keys(mix) as Array<keyof typeof mix>).filter(t => t !== type);
    
    const currentTotalOther = mix[otherTypes[0]] + mix[otherTypes[1]];
    const newTotalOther = 100 - newValue;
    
    let nextOther0, nextOther1;
    if (currentTotalOther === 0) {
      nextOther0 = newTotalOther / 2;
      nextOther1 = newTotalOther / 2;
    } else {
      const ratio0 = mix[otherTypes[0]] / currentTotalOther;
      const ratio1 = mix[otherTypes[1]] / currentTotalOther;
      nextOther0 = newTotalOther * ratio0;
      nextOther1 = newTotalOther * ratio1;
    }
    
    setMix({
      [type]: newValue,
      [otherTypes[0]]: nextOther0,
      [otherTypes[1]]: nextOther1,
    } as any);
  };

  useEffect(() => {
    const calculateResults = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/calculate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...mix, region: selectedRegion, weather_scenario: selectedWeather }),
        });
        const data = await response.json();
        setResults(data);
      } catch (error) {
        console.error("데이터 계산 실패:", error);
      }
    };

    const timer = setTimeout(calculateResults, 300);
    return () => clearTimeout(timer);
  }, [mix, selectedRegion, selectedWeather]);

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-slate-50">
      <header className="w-full max-w-6xl mb-8">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">ClimateLoop</h1>
        <p className="text-slate-600">인터랙티브 기후 및 에너지 시뮬레이터</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-6xl">
        {/* Left Panel: Map & Region Selection */}
        <div className="lg:col-span-8 bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">지역별 에너지 적합도</h2>
              <p className="text-sm text-blue-600 font-medium">현재 선택: {selectedRegion}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500 uppercase">평균 탄소 발자국</p>
              <p className="text-2xl font-bold text-blue-600">{results?.carbon_emissions ?? '--'} <span className="text-sm font-normal text-slate-400">gCO2/kWh</span></p>
            </div>
          </div>
          
          <div className="w-full h-[400px] bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative mb-6">
            <MapWrapper selectedRegion={selectedRegion} onRegionChange={setSelectedRegion} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(results?.suitability || { '태양광': 0, '풍력': 0, '수력': 0, '화력': 0 }).map(([source, val]) => (
              <div key={source} className="p-4 bg-white rounded-lg border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    {SOURCE_ICONS[source]}
                    <span className="text-sm font-semibold text-slate-700">{source}</span>
                  </div>
                  <span className="text-sm font-bold text-blue-600">{Math.round(val)}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-500 ease-out"
                    style={{ width: `${val}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-tighter">Regional Efficiency Score</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel: Controls & AI */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Weather Scenario Section */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-semibold mb-3 text-slate-800">기후 시나리오 설정</h2>
            <div className="grid grid-cols-2 gap-2">
              {WEATHER_SCENARIOS.map((scen) => (
                <button
                  key={scen.id}
                  onClick={() => setSelectedWeather(scen.id)}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedWeather === scen.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {scen.icon}
                  {scen.label}
                </button>
              ))}
            </div>
            {results?.grid_stability && (
              <div className={`mt-4 p-3 rounded-lg border flex items-center gap-2 text-xs ${
                results.grid_stability.includes("불안정")
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : 'bg-green-50 border-green-100 text-green-700'
              }`}>
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <div>
                  <span className="font-bold">전력망 안정도:</span> {results.grid_stability}
                </div>
              </div>
            )}
          </div>

          {/* Energy Mix Sliders */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-semibold mb-4 text-slate-800">에너지 믹스 설정</h2>
            <div className="space-y-4">
              {(['renewable', 'nuclear', 'fossil'] as const).map((type) => (
                <div key={type}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 font-medium">{MIX_LABELS[type]}</span>
                    <span className="font-medium">{Math.round(mix[type])}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0"
                    max="100"
                    value={mix[type]}
                    onChange={(e) => handleSliderChange(type, e.target.value)}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">지속 가능성 점수</span>
                <span className="text-lg font-bold text-green-600">{results?.sustainability_score ?? 0}%</span>
              </div>
            </div>
          </div>

          {/* AI Assistant */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex-grow">
            <h2 className="text-xl font-semibold mb-4 text-slate-800">AI 어시스턴트</h2>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 mb-4 min-h-[100px] leading-relaxed">
              {results?.ai_message || "슬라이더를 조절하여 환경에 미치는 영향을 확인해 보세요."}
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder="영향에 대해 물어보세요..." className="flex-grow px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors">
                전송
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
