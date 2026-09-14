import React from 'react';
import Image from 'next/image';

/**
 * 기상이 인사말 박스.
 *
 * "왜 이 점수인가요?" 칼럼은 접힌 <details> 하나뿐이어서, 옆 두 칼럼과 아래끝을
 * 맞추는 stretch 때문에 카드 아래로 300px 넘는 빈 공간이 남아 있었다. 그 자리를
 * 내용으로 채우지 못하고 비워 두는 대신 이 박스가 받는다.
 *
 * 높이를 스스로 정하지 않는다 — 부모(칼럼)가 flex 컬럼이고 이 박스가 flex-1 이라,
 * 남는 높이를 전부 받아 늘어나고 위 카드가 펼쳐지면 그만큼 줄어든다. minHeight 는
 * 그 줄어듦의 하한이다: 그림자·이미지·두 줄 글자가 겹치지 않는 선.
 *
 * 세로로 길어질 수 있으므로 내용을 가운데 정렬한다. 위쪽에 붙여 두면 박스가 500px
 * 가까이 늘어난 상태에서 인사말만 천장에 매달린 것처럼 보인다.
 */
export default function GisangiGreeting() {
  return (
    /*
      max-h 를 씌운다. flex-1 만 있던 시절 이 박스는 옆 칼럼(다음 단계)이 400px 로
      자라면 함께 370px 까지 늘어났고, 안에 든 것은 말풍선 두 줄 + 56px 이미지뿐이라
      화면에서 가장 큰 빈 상자가 됐다. 상한을 두면 남는 높이는 칼럼 안에 그대로
      남는데, 섹션 트레이가 없어진 지금 그 자리는 페이지 배경(slate-100)이라 아무
      상자도 없이 비어 보인다 — 큰 빈 상자를 두는 것보다 낫다. flex-1 은 그대로
      둔다: 칼럼이 짧을 때는 여전히 남는 만큼을 받아 위 카드와 아래끝을 맞춘다.

      상자 자체는 테두리 대신 카드와 같은 얇은 그림자 한 겹을 쓴다. 종전의
      slate-50 바탕 + 테두리는 섹션이 흰 트레이(bg-white/70) 위에 있을 때의 값이고,
      배경이 slate-100 으로 바뀐 지금은 상자가 배경에 묻힌다.
    */
    <div
      className="flex max-h-[13rem] flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-white shadow-card px-4 py-5"
      /*
        min-height 를 클래스가 아니라 style 로 주는 이유는 없다 — 다만 이 값이
        "무엇의 합인지"가 코드에 남아야 나중에 이미지 크기를 바꿀 때 함께 고쳐진다.
        말풍선 두 줄(약 46) + 간격(12) + 이미지(56) + 간격(12) + 출처 줄(16) + 위아래 여백(40).
      */
      style={{ minHeight: 182 }}
    >
      {/*
        말풍선 — 꼬리 있는 단순한 사각형. 꼬리는 45도 돌린 정사각형의 두 변에만
        테두리를 남겨 만든다. 흰 바탕이 말풍선 아래 테두리 한 조각을 덮으면서
        윤곽이 자연스럽게 이어진다. 별도 SVG 나 가상요소가 필요 없다.
      */}
      <div className="relative max-w-[15rem] rounded-lg border border-slate-200 bg-white px-3 py-2">
        <p className="text-xs leading-relaxed text-slate-600">
          안녕하세요, 저는 기상이예요! 지구를 위한 에너지 조합, 저와 함께 한 걸음씩 완성해 가요.
        </p>
        <span
          aria-hidden="true"
          className="absolute -bottom-[5px] left-1/2 -ml-[4.5px] h-[9px] w-[9px] rotate-45 border-b border-r border-slate-200 bg-white"
        />
      </div>

      {/*
        alt 를 비워 둔다. 바로 위 말풍선이 이 캐릭터의 인사말이고 아래 줄이 이름과
        출처를 적고 있어서, 이미지까지 읽으면 스크린리더에서 같은 말이 세 번 된다.
      */}
      <Image
        src="/images/gisangi-hello.png"
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 shrink-0 object-contain"
      />

      {/*
        문구가 "이미지"인 것은 중요하다. 이 앱은 기상청 관측 데이터를 쓰지 않는다 —
        기후 시나리오는 백엔드에 박아 둔 배수(solar_mult/wind_mult/demand_mult)이고,
        화면 각주마다 "관측·집계 통계가 아니라 시뮬레이션값"이라고 적고 있다. 그래서
        "기상 데이터 제공"으로 쓰면 같은 화면의 각주와 어긋나는 거짓 출처가 된다.
        밝힐 것은 마스코트 이미지의 출처뿐이다.

        ── 이용 조건을 함께 적는 이유 ──

        이 이미지는 기상청에서 사용 허락을 받은 저작물이고 조건이 "출처표시 +
        상업적 이용금지"(공공누리 제2유형과 같은 조건)다. 출처표시는 기관 이름만
        적는 것으로 끝나지 않는다 — 어떤 조건으로 쓰고 있는지가 함께 보여야, 이
        화면을 보거나 리포지토리를 받은 사람이 자기가 무엇을 할 수 있는지 알 수 있다.
        특히 이 프로젝트의 코드는 MIT 라 상업적 이용이 자유로운데 이 이미지 하나만
        아니므로, 그 구분이 각주에서 드러나야 한다.

        문구를 지우거나 줄이면 출처표시 조건을 위반한다. 이미지를 다른 화면·매체로
        옮길 때도 이 표기를 함께 옮겨야 한다. 상세는 리포지토리 LICENSE-ASSETS.md 에 있다.
      */}
      <p className="text-xs text-slate-400 text-center leading-snug">
        기상이 이미지: 기상청
        <span className="block">(공공누리 제2유형 — 출처표시, 상업적 이용금지)</span>
      </p>
    </div>
  );
}
