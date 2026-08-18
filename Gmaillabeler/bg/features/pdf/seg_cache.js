// bg/features/pdf/seg_cache.js
// 번역 캐시의 서비스워커 쪽 얼굴. 키 계산(pdf/text/cache_key.js)과 저장소(shared/pdf_db.js)를 엮는다.
//
// 이게 "이어하기"의 전부다. 별도의 체크포인트 파일이나 재개 상태 기계를 두지 않는다:
// 배치가 성공하는 즉시 그 번역문을 캐시에 적어두면, 같은 문서를 같은 조건으로 다시 돌릴 때
// 이미 번역한 세그먼트는 조회로 채워지고 남은 구간만 API를 쓴다. 중지든 할당량 소진이든
// 서비스워커가 죽은 것이든 구분 없이 같은 방식으로 이어진다.
//
// 캐시 실패는 절대 번역을 막지 않는다. 조회가 터지면 "캐시 없음"으로, 저장이 터지면
// "다음 실행에서 다시 번역"으로 물러난다. 캐시는 돈과 시간을 아끼는 장치일 뿐이다.

import { getSegCacheEntries, putSegCacheEntries, pruneSegCache } from "../../../shared/pdf_db.js";
import { segCacheKeys } from "../../../pdf/text/cache_key.js";
import { addLog } from "../../core/logger.js";

// 상한. 한 번의 문서 번역이 수천 건을 쓰므로 문서 수십 개분은 남는다.
const SEG_CACHE_LIMIT = 20000;

/** 세그먼트에 cacheKey를 붙인다. 실패하면 키 없이 두고 false를 돌려준다. */
async function attachCacheKeys(segments, options) {
  try {
    const keys = await segCacheKeys(segments, options);
    segments.forEach((seg, i) => {
      seg.cacheKey = keys[i];
    });
    return true;
  } catch (e) {
    await addLog(`[PDF] 번역 캐시 키를 만들지 못해 캐시 없이 진행합니다: ${(e && e.message) || e}`, "warn");
    for (const seg of segments) seg.cacheKey = null;
    return false;
  }
}

/**
 * 캐시에 있는 번역문을 세그먼트에 채운다(제자리 수정).
 * 채워진 세그먼트는 seg.translated 가 있고 seg.fromCache === true 다.
 * @returns {Promise<number>} 캐시로 채운 세그먼트 수
 */
async function applyCachedTranslations(segments) {
  const keys = [...new Set(segments.map((s) => s.cacheKey).filter(Boolean))];
  if (!keys.length) return 0;

  let found;
  try {
    found = await getSegCacheEntries(keys);
  } catch (e) {
    await addLog(`[PDF] 번역 캐시를 읽지 못해 전체를 다시 번역합니다: ${(e && e.message) || e}`, "warn");
    return 0;
  }

  let hits = 0;
  for (const seg of segments) {
    const cached = seg.cacheKey && found.get(seg.cacheKey);
    if (!cached) continue;
    seg.translated = cached;
    seg.translationFailed = false;
    seg.fromCache = true;
    hits += 1;
  }
  return hits;
}

/**
 * 방금 성공한 번역문을 캐시에 적는다. 배치마다 부르는 것이 중요하다 -
 * 문서 끝에서 한 번만 적으면 중간에 워커가 죽었을 때 그때까지의 진행분이 남지 않는다.
 * 실패한(원문 유지) 세그먼트는 적지 않는다.
 */
async function rememberTranslations(segments, docId) {
  const entries = [];
  for (const seg of segments) {
    if (!seg.cacheKey || seg.fromCache || seg.translationFailed) continue;
    if (!seg.translated || seg.translated === seg.text) continue;
    entries.push({ key: seg.cacheKey, translated: seg.translated, docId });
  }
  if (!entries.length) return 0;

  try {
    return await putSegCacheEntries(entries);
  } catch (e) {
    // 여기서 실패해도 이번 실행의 결과 파일은 정상적으로 나온다. 다음 실행에서 다시 번역할 뿐이다.
    await addLog(`[PDF] 번역 캐시 저장 실패(진행에는 영향 없음): ${(e && e.message) || e}`, "warn");
    return 0;
  }
}

/** 작업이 끝난 뒤 상한을 넘은 만큼 오래된 항목을 걷어낸다. */
async function trimSegCache() {
  try {
    return await pruneSegCache(SEG_CACHE_LIMIT);
  } catch (e) {
    return 0;
  }
}

export { SEG_CACHE_LIMIT, attachCacheKeys, applyCachedTranslations, rememberTranslations, trimSegCache };
