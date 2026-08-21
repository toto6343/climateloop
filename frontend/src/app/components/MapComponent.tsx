'use client';

import React, { memo, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatMwh, RegionStat } from './energySources';
import { KOREA_BOUNDS, REGIONS } from './regions';

// 마커 반지름(px). 지역별 추정 발전량(MWh)을 min-max 정규화해 이 구간에 편다.
//
// 지도를 낮게 줄이면서 한반도가 차지하는 픽셀도 함께 줄었다. 예전 8~24px 를
// 그대로 두면 수도권 네 지역(서울·인천·경기·세종)이 한 덩어리로 뭉쳐 서로를
// 가린다. 절대 크기는 줄었지만 지도 대비 비율은 오히려 커졌다.
const MIN_RADIUS = 5;
const MAX_RADIUS = 11;
/** 값이 없거나 0인 지역(데이터 로딩 전 포함). 크기로 아무것도 주장하지 않는 중립 크기. */
const FALLBACK_RADIUS = 6;
/** 선택된 지역만 더 크게. 크기·색·테두리·링을 한꺼번에 달리해야 눈에 걸린다. */
const SELECTED_RADIUS_BOOST = 3;
/** 선택 마커를 감싸는 링과 본체 사이 간격(px). */
const SELECTED_RING_GAP = 5;

/*
  선택된 지역만 브랜드 색, 나머지는 무채색.

  전에는 둘 다 파랑(blue-600 / blue-300)이었다. 파랑은 그때의 수력 데이터 색이기도
  해서 같은 화면에서 "파란 원"이 지역 선택과 발전원 둘을 가리켰고, 옅은 파랑은 선택
  마커와 채도만 다를 뿐이어서 훑어볼 때 구분이 잘 되지 않았다. 선택은 상태이므로
  브랜드 색을 쓰고, 선택되지 않은 원은 크기만으로 발전량을 말하는 배경으로 물린다.

  발전원 팔레트가 그린 → 인디고 축으로 바뀌면서(energySources.ts) 수력이 다시
  인디고 계열(#6366f1)이 됐다 — 지도 바로 옆 도넛에 그 색이 있다. 이번에는 색상이
  아니라 **명도**로 갈린다: 선택 마커는 #4338ca(상대휘도 약 0.095), 수력 조각은
  그보다 두 배 밝은 #6366f1(약 0.19)이다. 데이터 램프를 짤 때 브랜드가 앉은 중간
  명도 한 칸을 의도적으로 비워 둔 이유가 이것이다.
*/
const MARKER_COLOR = '#4338ca';        // brand-600 — 선택된 지역
const MARKER_IDLE_COLOR = '#cbd5e1';   // slate-300 — 선택되지 않은 지역은 무채색으로 물린다

/**
 * 17개 지역이 모두 보이도록 축척을 맞춘다.
 *
 * MapContainer 의 bounds prop 은 최초 마운트에만 쓰이므로, 반응형으로 지도 폭이
 * 바뀌는 이 레이아웃에서는 그것만으로 부족하다(모바일↔데스크톱 전환, 카드 폭 변화).
 * ResizeObserver 로 컨테이너 크기 변화를 잡아 다시 맞춘다 — fitBounds 는 컨테이너
 * 크기를 바꾸지 않으므로 관찰 → 조정이 서로를 다시 부르는 순환은 생기지 않는다.
 */
function FitRegionBounds() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const fit = () => {
      map.invalidateSize();
      // 마커 반지름(최대 14px)과 링까지 감안한 여백. 없으면 가장자리 지역
      // (제주·강원)의 원이 반쯤 잘린다.
      map.fitBounds(KOREA_BOUNDS, { padding: [18, 18], animate: false });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/**
 * 추정 발전량(MWh) → 반지름 변환 함수를 만든다.
 *
 * 0과 결측을 정규화 대상에서 빼는 이유: 아직 값이 오지 않은 지역이 최소값
 * 자리를 차지하면, 데이터가 도착한 뒤 나머지 지역의 크기 서열이 통째로
 * 바뀌어 보인다.
 */
function buildRadiusScale(values: number[]): (value?: number) => number {
  const usable = values.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length === 0) return () => FALLBACK_RADIUS;

  const min = Math.min(...usable);
  const max = Math.max(...usable);

  return (value?: number) => {
    if (!Number.isFinite(value) || !value || value <= 0) return FALLBACK_RADIUS;
    // 모든 지역이 같은 값이면 분모가 0이 된다. 이때는 서열이 없으므로
    // 전부 같은 중간 크기로 그린다 (한쪽 끝으로 몰면 없는 차이를 주장하게 된다).
    if (max === min) return (MIN_RADIUS + MAX_RADIUS) / 2;
    return MIN_RADIUS + ((value - min) / (max - min)) * (MAX_RADIUS - MIN_RADIUS);
  };
}

interface MapComponentProps {
  /** 강조해서 보여줄 지역. 이 지도는 값을 읽기만 하고 바꾸지 않는다. */
  selectedRegion: string;
  /** POST /regions 결과. 아직 없으면 모든 마커가 기본 크기로 그려진다. */
  regions?: RegionStat[];
}

/**
 * 선택된 지역을 강조해 보여주는 지도. 입력 장치가 아니라 표시 장치다.
 *
 * 마커 클릭으로도 지역을 고를 수 있던 시절에는 "무엇을 골랐는가"(selectedRegion,
 * 부모 소유)와 "상세 패널을 띄울 것인가"(isOverlayOpen, 이 컴포넌트 소유)가 서로
 * 다른 상태에 나뉘어 있었다. 후자는 마커 클릭 핸들러에서만 켜졌으므로, 지도 밖
 * 목록에서 지역을 고르면 마커 강조는 따라오는데 파이차트는 끝내 뜨지 않았다.
 *
 * 지금은 상태가 selectedRegion 하나뿐이다. 마커 강조도, 옆 칸의 발전원 구성 패널도
 * 모두 그 하나에서 파생되므로, 지역을 바꾸는 입력이 무엇이든(지금은 select box,
 * 나중에 무엇이 되든) 둘은 언제나 함께 움직인다.
 */
const MapComponent = ({ selectedRegion, regions = [] }: MapComponentProps) => {
  const statByName = new Map(regions.map((r) => [r.name, r]));
  const radiusOf = buildRadiusScale(regions.map((r) => r.totalGeneration));

  // 오버레이에 그릴 값은 매 렌더 최신 props에서 다시 찾는다. 열어둔 채로 에너지
  // 믹스나 기상 시나리오를 바꾸면 새 값이 내려오므로, 스냅샷을 들고 있으면
  // 오버레이만 옛 숫자에 머문다.
  //
  // 데이터가 아직 없으면 이름만 채운 빈 항목을 쓴다. 오버레이가 로딩 문구를
  // 띄우고, 값이 도착하면 이 조회가 자동으로 최신 데이터로 바꿔 그린다.
  // 선택 표시용 링이 따라다닐 좌표와 크기. 목록에 없는 지역명이 오면 링을 생략한다.
  const selectedCoords = REGIONS.find((r) => r.name === selectedRegion)?.coords;
  const selectedRadius =
    radiusOf(statByName.get(selectedRegion)?.totalGeneration) + SELECTED_RADIUS_BOOST;

  return (
    <div className="relative w-full h-full">
      <MapContainer
        bounds={KOREA_BOUNDS}
        // 0.25 단위까지 허용해야 fitBounds 가 낮아진 컨테이너에 꼭 맞는 축척을
        // 고를 수 있다. 기본값 1이면 한 단계 더 축소되어 여백만 넓어진다.
        zoomSnap={0.25}
        style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
        scrollWheelZoom={false}
        // Leaflet 기본 줌 컨트롤(+/- 버튼 두 개가 세로로 붙은 것)을 아예 만들지 않는다.
        // 이 컨트롤은 JSX 어디에도 없고 Leaflet 이 지도 초기화 때 DOM 에 직접 꽂으므로,
        // 화면에서 "위/아래 화살표 스테퍼"처럼 읽혀도 page.tsx 를 아무리 뒤져도 나오지 않는다.
        // CSS 로 숨기면 DOM 과 탭 순서에는 그대로 남으므로, 생성 자체를 끈다.
        //
        // 지도는 지역을 고르는 보조 수단이라 줌이 없어도 할 일이 줄지 않는다 —
        // FitRegionBounds 가 한반도에 맞춰 축척을 잡아 주고, 휠 줌은 이미 꺼져 있으며,
        // 지역 선택은 마커 클릭과 오른쪽 지역 칩 두 경로로 열려 있다.
        zoomControl={false}
      >
        <FitRegionBounds />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {REGIONS.map((region) => {
          const stat = statByName.get(region.name);
          const isSelected = selectedRegion === region.name;
          // 크기는 기본적으로 추정 발전량을 나타낸다. 선택된 하나만 예외로 키우는데,
          // 이 지역은 색·테두리·링·상시 라벨이 함께 달라져 "큰 지역"이 아니라
          // "고른 지역"으로 읽힌다.
          const radius = radiusOf(stat?.totalGeneration) + (isSelected ? SELECTED_RADIUS_BOOST : 0);

          return (
            <CircleMarker
              key={region.name}
              center={region.coords}
              radius={radius}
              pathOptions={{
                fillColor: isSelected ? MARKER_COLOR : MARKER_IDLE_COLOR,
                fillOpacity: isSelected ? 0.95 : 0.7,
                color: '#ffffff',
                weight: isSelected ? 3 : 1.5,
                // 마커는 여전히 interactive 다 — hover 라벨이 Leaflet 의 마우스
                // 이벤트에 얹혀 있기 때문이다. 다만 눌러도 하는 일이 없으므로
                // Leaflet 이 기본으로 씌우는 손가락 커서만 되돌린다.
                className: 'climateloop-marker-static',
              }}
            >
              {/* 선택된 지역은 라벨을 상시 노출해 지도만 봐도 어디가 켜져 있는지
                  알 수 있게 한다. 나머지는 hover 때만 — 17개를 모두 상시로 띄우면
                  라벨끼리 겹쳐 지도가 글자로 뒤덮인다.

                  key 로 강제 재마운트하는 이유: react-leaflet 은 Tooltip 인스턴스를
                  최초 렌더에서 한 번만 만들고 permanent·className 변경을 다시
                  반영하지 않아서, key 가 없으면 선택이 바뀌어도 상시 라벨이
                  처음 선택된 지역에 그대로 붙어 있는다. */}
              <MapTooltip
                key={isSelected ? 'label-permanent' : 'label-hover'}
                // 상시 라벨은 direction auto — Leaflet 이 마커가 놓인 쪽을 보고
                // 좌/우를 고른다. top 으로 고정하면 위쪽에 있는 서울·강원의 라벨이
                // 지도 상단 밖으로 나가 잘린다(컨테이너가 높이 258px 뿐이다).
                direction={isSelected ? 'auto' : 'top'}
                offset={isSelected ? [0, 0] : [0, -4]}
                permanent={isSelected}
                className={isSelected ? 'climateloop-tooltip-selected' : undefined}
              >
                <span className="font-semibold">{region.name}</span>
                {/* 상시 라벨에는 이름만 넣는다. 발전량까지 붙이면 라벨 폭이 140px가
                    되어 좁아진 지도의 절반을 덮는다. 숫자는 hover 때 보여준다. */}
                {!isSelected && stat && (
                  <span className="text-slate-500">
                    {' '}· 약 {formatMwh(stat.totalGeneration, 0)} MWh(추정)
                  </span>
                )}
              </MapTooltip>
            </CircleMarker>
          );
        })}

        {/*
          선택 표시용 링. 지역마다 하나씩 조건부로 그리는 대신, 링 하나가 선택된
          좌표를 따라 옮겨 다닌다. react-leaflet 은 pathOptions 를 생성 시점이 아니라
          마운트 뒤 setStyle 로 입히므로, 선택마다 새로 마운트하면 Leaflet 기본
          스타일(채워진 하늘색 원)이 한 프레임 스쳐 보인다.

          마커들보다 뒤에 그려 이웃 마커에 가리지 않게 한다. 채움이 없으니
          이웃을 덮는 것도 2px 선뿐이다.
        */}
        {selectedCoords && (
          <CircleMarker
            center={selectedCoords}
            radius={selectedRadius + SELECTED_RING_GAP}
            pathOptions={{
              fill: false,
              color: MARKER_COLOR,
              opacity: 0.45,
              weight: 2,
              className: 'climateloop-marker-static',
            }}
            // 이 링은 순전히 표시용이다. 마우스 이벤트를 받지 않아야 아래에 깔린
            // 선택 마커의 hover 라벨이 링 위에서도 그대로 뜬다.
            interactive={false}
          />
        )}
      </MapContainer>

    </div>
  );
};

export default memo(MapComponent);
