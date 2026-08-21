# 서드파티 고지 (Third-Party Notices)

이 리포지토리의 소스 코드는 MIT 라이선스입니다([LICENSE](LICENSE)).
이미지 자산의 별도 조건은 [LICENSE-ASSETS.md](LICENSE-ASSETS.md) 를 참고하십시오.

이 문서는 배포물에 포함되거나 빌드에 쓰이는 서드파티 구성요소 중 **고지 의무가
있거나 조건을 확인해 둘 필요가 있는 것**만 모았습니다. 순수 MIT/ISC/BSD/Apache-2.0
패키지는 개수가 많아 여기 일일이 적지 않습니다 — 전체 목록은 아래 명령으로 언제든
재생성할 수 있습니다.

```bash
# 프론트엔드 (프로덕션 의존성 93개)
cd frontend && npx license-checker-rseidelsohn --production --summary

# 백엔드 (83개)
cd backend && python -m pip install pip-licenses && python -m piplicenses --format=markdown
```

마지막 감사: **2026-08-21**

---

## 1. Hippocratic License 2.1 — react-leaflet

| 항목 | 내용 |
|---|---|
| 패키지 | `react-leaflet@5.0.0`, `@react-leaflet/core@3.0.0` |
| 저작권 | Copyright 2020 Paul Le Cam and contributors |
| 라이선스 | **Hippocratic License 2.1** (OSI 미승인) |
| 저장소 | https://github.com/PaulLeCam/react-leaflet |
| 쓰이는 곳 | 지도 컴포넌트 (`frontend/src/app/components/MapComponent.tsx`) |

### 왜 따로 적는가

Hippocratic 2.1 은 MIT 계열이 아닙니다. 인권 관련 사용 제한 조항이 있고, 위반 시
라이선스가 종료됩니다. 그리고 **고지 의무가 명시**돼 있습니다 — 이 소프트웨어의
일부를 받는 사람은 라이선스 전문과 저작권 표시를 함께 받아야 하며, 수정한 경우
수정했다는 사실을 눈에 띄게 밝혀야 합니다. 그래서 요약이 아니라 전문을 싣습니다.

이 프로젝트는 react-leaflet 을 **수정하지 않고** 그대로 사용합니다.

> **참고**: 지도 렌더링 본체인 `leaflet@1.9.4` 는 별개 패키지이며 BSD-2-Clause 입니다.

### 전문

```
react-leaflet Copyright 2020 Paul Le Cam and contributors (“Licensor”)

Hippocratic License Version Number: 2.1.

Purpose. The purpose of this License is for the Licensor named above to permit the Licensee (as defined below) broad permission, if consistent with Human Rights Laws and Human Rights Principles (as each is defined below), to use and work with the Software (as defined below) within the full scope of Licensor’s copyright and patent rights, if any, in the Software, while ensuring attribution and protecting the Licensor from liability.

Permission and Conditions. The Licensor grants permission by this license (“License”), free of charge, to the extent of Licensor’s rights under applicable copyright and patent law, to any person or entity (the “Licensee”) obtaining a copy of this software and associated documentation files (the “Software”), to do everything with the Software that would otherwise infringe (i) the Licensor’s copyright in the Software or (ii) any patent claims to the Software that the Licensor can license or becomes able to license, subject to all of the following terms and conditions:

- Acceptance. This License is automatically offered to every person and entity subject to its terms and conditions. Licensee accepts this License and agrees to its terms and conditions by taking any action with the Software that, absent this License, would infringe any intellectual property right held by Licensor.

- Notice. Licensee must ensure that everyone who gets a copy of any part of this Software from Licensee, with or without changes, also receives the License and the above copyright notice (and if included by the Licensor, patent, trademark and attribution notice). Licensee must cause any modified versions of the Software to carry prominent notices stating that Licensee changed the Software. For clarity, although Licensee is free to create modifications of the Software and distribute only the modified portion created by Licensee with additional or different terms, the portion of the Software not modified must be distributed pursuant to this License. If anyone notifies Licensee in writing that Licensee has not complied with this Notice section, Licensee can keep this License by taking all practical steps to comply within 30 days after the notice. If Licensee does not do so, Licensee’s License (and all rights licensed hereunder) shall end immediately.

- Compliance with Human Rights Principles and Human Rights Laws.

  1. Human Rights Principles.

     (a) Licensee is advised to consult the articles of the United Nations Universal Declaration of Human Rights and the United Nations Global Compact that define recognized principles of international human rights (the “Human Rights Principles”). Licensee shall use the Software in a manner consistent with Human Rights Principles.

     (b) Unless the Licensor and Licensee agree otherwise, any dispute, controversy, or claim arising out of or relating to (i) Section 1(a) regarding Human Rights Principles, including the breach of Section 1(a), termination of this License for breach of the Human Rights Principles, or invalidity of Section 1(a) or (ii) a determination of whether any Law is consistent or in conflict with Human Rights Principles pursuant to Section 2, below, shall be settled by arbitration in accordance with the Hague Rules on Business and Human Rights Arbitration (the “Rules”); provided, however, that Licensee may elect not to participate in such arbitration, in which event this License (and all rights licensed hereunder) shall end immediately. The number of arbitrators shall be one unless the Rules require otherwise.

     Unless both the Licensor and Licensee agree to the contrary: (1) All documents and information concerning the arbitration shall be public and may be disclosed by any party; (2) The repository referred to under Article 43 of the Rules shall make available to the public in a timely manner all documents concerning the arbitration which are communicated to it, including all submissions of the parties, all evidence admitted into the record of the proceedings, all transcripts or other recordings of hearings and all orders, decisions and awards of the arbitral tribunal, subject only to the arbitral tribunal's powers to take such measures as may be necessary to safeguard the integrity of the arbitral process pursuant to Articles 18, 33, 41 and 42 of the Rules; and (3) Article 26(6) of the Rules shall not apply.

  2. Human Rights Laws. The Software shall not be used by any person or entity for any systems, activities, or other uses that violate any Human Rights Laws. “Human Rights Laws” means any applicable laws, regulations, or rules (collectively, “Laws”) that protect human, civil, labor, privacy, political, environmental, security, economic, due process, or similar rights; provided, however, that such Laws are consistent and not in conflict with Human Rights Principles (a dispute over the consistency or a conflict between Laws and Human Rights Principles shall be determined by arbitration as stated above). Where the Human Rights Laws of more than one jurisdiction are applicable or in conflict with respect to the use of the Software, the Human Rights Laws that are most protective of the individuals or groups harmed shall apply.

  3. Indemnity. Licensee shall hold harmless and indemnify Licensor (and any other contributor) against all losses, damages, liabilities, deficiencies, claims, actions, judgments, settlements, interest, awards, penalties, fines, costs, or expenses of whatever kind, including Licensor’s reasonable attorneys’ fees, arising out of or relating to Licensee’s use of the Software in violation of Human Rights Laws or Human Rights Principles.

- Failure to Comply. Any failure of Licensee to act according to the terms and conditions of this License is both a breach of the License and an infringement of the intellectual property rights of the Licensor (subject to exceptions under Laws, e.g., fair use). In the event of a breach or infringement, the terms and conditions of this License may be enforced by Licensor under the Laws of any jurisdiction to which Licensee is subject. Licensee also agrees that the Licensor may enforce the terms and conditions of this License against Licensee through specific performance (or similar remedy under Laws) to the extent permitted by Laws. For clarity, except in the event of a breach of this License, infringement, or as otherwise stated in this License, Licensor may not terminate this License with Licensee.

- Enforceability and Interpretation. If any term or provision of this License is determined to be invalid, illegal, or unenforceable by a court of competent jurisdiction, then such invalidity, illegality, or unenforceability shall not affect any other term or provision of this License or invalidate or render unenforceable such term or provision in any other jurisdiction; provided, however, subject to a court modification pursuant to the immediately following sentence, if any term or provision of this License pertaining to Human Rights Laws or Human Rights Principles is deemed invalid, illegal, or unenforceable against Licensee by a court of competent jurisdiction, all rights in the Software granted to Licensee shall be deemed null and void as between Licensor and Licensee. Upon a determination that any term or provision is invalid, illegal, or unenforceable, to the extent permitted by Laws, the court may modify this License to affect the original purpose that the Software be used in compliance with Human Rights Principles and Human Rights Laws as closely as possible. The language in this License shall be interpreted as to its fair meaning and not strictly for or against any party.

- Disclaimer. TO THE FULL EXTENT ALLOWED BY LAW, THIS SOFTWARE COMES “AS IS,” WITHOUT ANY WARRANTY, EXPRESS OR IMPLIED, AND LICENSOR AND ANY OTHER CONTRIBUTOR SHALL NOT BE LIABLE TO ANYONE FOR ANY DAMAGES OR OTHER LIABILITY ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THIS LICENSE, UNDER ANY KIND OF LEGAL CLAIM.

This Hippocratic License is an Ethical Source license (https://ethicalsource.dev) and is offered for use by licensors and licensees at their own risk, on an “AS IS” basis, and with no warranties express or implied, to the maximum extent permitted by Laws.

Some portions of code from previous versions of react-leaflet are released under the MIT License (MIT):

Copyright (c) 2015-2020 Paul Le Cam and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 2. LGPL-3.0-or-later — sharp (전이 의존성)

| 항목 | 내용 |
|---|---|
| 패키지 | `sharp@0.34.5` → `@img/sharp-<platform>@0.34.5` |
| 라이선스 | **Apache-2.0 AND LGPL-3.0-or-later** |
| 저장소 | https://github.com/lovell/sharp |
| 경로 | `next@16.2.9` → `sharp` (직접 의존성이 아닙니다) |

`sharp` 자체는 Apache-2.0 이지만, 플랫폼별 프리빌트 패키지가 **libvips**(LGPL-3.0)를
함께 담고 있어 위와 같이 표기됩니다. Next.js 의 이미지 최적화(`next/image`)가 쓰며,
이 프로젝트에서는 마스코트 이미지 한 장을 그리는 데 관여합니다.

**의무**: 라이브러리를 수정하지 않고 동적으로 사용하는 형태이므로 재배포가 가능하며,
이 고지를 유지하고 LGPL 원문 입수 경로를 밝히면 됩니다.
LGPL-3.0 전문: https://www.gnu.org/licenses/lgpl-3.0.html

**주의**: 설치되는 패키지 이름이 플랫폼마다 다릅니다(`sharp-win32-x64`,
`sharp-linux-x64`, `sharp-darwin-arm64` 등). 라이선스 조건은 모두 같습니다.

---

## 3. CC-BY-4.0 — caniuse-lite (빌드 전용)

| 항목 | 내용 |
|---|---|
| 패키지 | `caniuse-lite@1.0.30001799` |
| 라이선스 | CC-BY-4.0 |
| 경로 | `next` → `browserslist` → `caniuse-lite` |

브라우저 지원 범위 표로, **빌드 시점에만** 쓰이고 배포되는 산출물에는 포함되지
않습니다. 데이터 자체를 재배포한다면 CC-BY 표시 의무가 생기지만 이 프로젝트는
그렇게 쓰지 않습니다. 참고용으로만 적어 둡니다.

---

## 4. 제거된 고지 — fpdf2 (LGPL-3.0-only)

한동안 서버에서 PDF 를 만드는 `POST /generate-pdf` 엔드포인트가 `fpdf2`(LGPL-3.0-only)를
썼고, 함께 배포하려고 나눔고딕(`backend/fonts/NanumGothic.ttf`, SIL OFL-1.1)을 번들해
두었습니다.

**둘 다 제거했습니다.** 프론트엔드가 그 엔드포인트를 한 번도 호출하지 않았기
때문입니다 — 화면의 "결과 리포트 저장"은 브라우저에서 `jspdf` + `html2canvas`
(둘 다 MIT)로 PDF 를 만듭니다. 쓰지 않는 경로 하나 때문에 배포물에 LGPL 고지
의무와 폰트 재배포 의무를 지고 있을 이유가 없었습니다.

서버측 PDF 생성이 다시 필요해지면 `fpdf2` 를 되살리고 **이 절에 LGPL-3.0 고지를
복구**해야 합니다. 한글 출력을 위해 폰트를 다시 번들한다면 OFL 고지도 함께입니다.

---

## 5. 공공데이터

화면의 "데이터 출처" 아코디언과 같은 내용입니다. 리포지토리에 **파일로 커밋된** 두
자료의 재배포 가능 여부가 특히 중요하므로 이용허락범위를 함께 적습니다.

| 자료 | 제공 | 형태 | 기준연도 | 이용허락범위 |
|---|---|---|---|---|
| 지역별 발전설비 설비용량 (EPSIS) | 한국전력거래소 | **리포지토리 커밋** `backend/data/kpx_capacity_by_region_2025.csv` | 2025 | **제한 없음** |
| 기초지자체별 신재생에너지 보급 현황 | 한국에너지공단 | **리포지토리 커밋** `backend/data/kea_renewable_by_region_2024.csv` | 2024 | **제한 없음** |
| 단기예보(초단기실황) · 기상특보 | 기상청 | 런타임 API | — | 공공데이터포털 개방 API |
| 발전원별 발전량 현황(GW) | 한국전력거래소 | 런타임 API (현재 미승인·미반영) | — | 공공데이터포털 개방 API |

두 스냅샷 파일은 공공데이터포털에서 **"이용허락범위 제한 없음"** 으로 공개된
자료이므로 리포지토리에 포함해 재배포할 수 있습니다(2026-08-21 확인).

각 파일 맨 위 주석에 출처 URL·취득일·가공 내역(인코딩 변환, 합계 행 중복 제거 등)이
적혀 있습니다.

---

## 6. OpenRouter (LLM API)

| 항목 | 내용 |
|---|---|
| 쓰이는 곳 | AI 어시스턴트 해설·채팅 (`backend/agent.py`, `backend/chat.py`) |
| 약관 | https://openrouter.ai/terms |

- 이 API 를 호출하는 **소스 코드의 재배포에는 제약이 없고, 귀속 표시 요구도 없습니다.**
- 다만 약관은 "API 접근 재판매 또는 경쟁 서비스 개발"을 금지합니다.
- **모델 출력물의 권리는 모델별 Model Terms 를 따릅니다** — 상업적 활용을 계획한다면
  실제로 쓰는 모델(기본값 `google/gemini-2.5-flash-lite`)의 조건을 개별 확인해야 합니다.
- **API 키의 보안과 사용료는 전적으로 키 소유자 책임**입니다. 이 리포지토리를 배포받아
  실행하는 사람은 자기 키를 발급해 써야 합니다.

키가 없어도 애플리케이션은 동작합니다 — 해설이 계산 결과 기반 문구로 대체되고
화면 배지가 "즉시 요약"으로 바뀝니다.
