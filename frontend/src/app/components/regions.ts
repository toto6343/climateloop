/**
 * 17개 시·도의 이름과 지도 좌표.
 *
 * 지도(MapComponent)와 지역 선택 칩(page.tsx)이 같은 목록을 써야 하는데,
 * 지도는 `ssr: false` 로 동적 로드되므로 목록이 그 안에 있으면 서버 렌더 단계의
 * 칩이 참조할 수 없다. 그래서 좌표까지 포함해 이 모듈로 분리했다.
 *
 * name 은 백엔드 REGION_FACTORS 의 키와 같은 문자열이어야 한다 —
 * /calculate 의 region 파라미터로 그대로 나간다.
 */

export interface Region {
  name: string;
  coords: [number, number];
}

export const REGIONS: Region[] = [
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

/** 칩 목록용. 배열 순서가 곧 표시 순서다. */
export const REGION_NAMES: string[] = REGIONS.map((r) => r.name);

/**
 * 17개 좌표를 모두 담는 최소 사각형. [남서, 북동].
 *
 * 지도를 center+zoom 으로 고정하지 않고 이 범위에 맞추는 이유: 컨테이너를
 * 낮게 줄이고 나면 고정 zoom 7 에서는 제주(33.5)와 강원 북부(37.8)가 화면
 * 밖으로 잘린다. 잘린 지역은 마커가 아예 보이지 않아 "없는 지역"처럼 읽힌다.
 */
export const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [
    Math.min(...REGIONS.map((r) => r.coords[0])),
    Math.min(...REGIONS.map((r) => r.coords[1])),
  ],
  [
    Math.max(...REGIONS.map((r) => r.coords[0])),
    Math.max(...REGIONS.map((r) => r.coords[1])),
  ],
];
