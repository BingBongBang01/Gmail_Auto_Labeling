// bg/core/job_registry.js
// 팝업/사이드패널/옵션은 모두 { action: "job.start", jobType, payload } 하나로 작업을 시작한다.
// 여기서 jobType -> 실행 함수 매핑을 관리한다.
//
// 이 레지스트리가 있어서:
//   1. "이미 다른 작업이 실행 중" 검사가 모든 작업에 빠짐없이 적용된다.
//      (예전에는 캘린더 분류가 이 검사를 우회해서 다른 작업과 겹쳐 돌 수 있었다)
//   2. 기능끼리 서로를 import 하지 않고도 작업을 시작할 수 있다.
//      자동화(automation)는 startJob("gmail_summarize", ...)만 부르면 되고,
//      요약 기능이 어디 있는지 알 필요가 없다.

import { SettingsStore } from "../../settings/settings_store.js";
import { isJobRunning, markJobRunning, runJob } from "./job_runner.js";

const jobs = new Map(); // 정규 jobType -> descriptor
const aliases = new Map(); // 옛 이름 -> 정규 jobType

/**
 * 작업 유형을 등록한다.
 *
 * @param {string} type 정규 jobType (예: "gmail_classify")
 * @param {object} descriptor
 *   - aliases: string[]            UI가 아직 보내는 옛 이름들 (예: "gmail.classification")
 *   - jobKind: string              markJobRunning에 기록할 종류
 *   - notifyTitleKey: string       완료 알림 제목의 i18n 키
 *   - resolve(payload, settings)   시작 전 검증 + 실행 함수 생성. 다음 중 하나를 돌려준다.
 *       { error } 또는 { messageKey }        -> 시작하지 않고 그대로 응답
 *       { run, response?, notifyTitleParams? } -> run을 runJob으로 감싸 실행하고 response로 응답
 */
function registerJob(type, descriptor) {
  jobs.set(type, descriptor);
  for (const alias of descriptor.aliases || []) aliases.set(alias, type);
}

function resolveJobType(jobType) {
  return aliases.get(jobType) || jobType;
}

async function startJob(jobType, payload = {}) {
  const normalized = resolveJobType(jobType);
  const job = jobs.get(normalized);
  if (!job) {
    return { ok: false, error: `지원하지 않는 작업 유형입니다: ${jobType}` };
  }

  // 모든 작업에 동일하게 적용되는 단일 관문.
  if (await isJobRunning()) {
    return { ok: false, messageKey: "errorAlreadyRunning" };
  }

  const settings = await SettingsStore.getSettings();
  const resolved = await job.resolve(payload, settings);

  // resolve가 실행 함수를 주지 않았다면 시작 조건을 못 맞춘 것이다(라벨 미선택 등).
  if (!resolved || typeof resolved.run !== "function") {
    return resolved && (resolved.error || resolved.messageKey)
      ? { ok: false, ...resolved }
      : { ok: false, error: `작업을 시작할 수 없습니다: ${normalized}` };
  }

  await markJobRunning(job.jobKind || normalized);
  // 일부러 await 하지 않는다. 작업은 백그라운드에서 계속 돌고, UI에는 즉시 "시작됨"을 알린다.
  runJob(resolved.run, job.notifyTitleKey, resolved.notifyTitleParams || job.notifyTitleParams);

  return resolved.response || { ok: true, started: true };
}

function getRegisteredJobTypes() {
  return Array.from(jobs.keys());
}

// 화면이 "이 타일이 가리키는 작업이 실제로 있는가"를 검사할 때 쓴다.
// 별칭까지 넣어야 한다 - 타일이 옛 이름(docs_translate 등)을 가리키는 경우가 있고,
// startJob은 그것도 정상 처리하기 때문이다.
function getKnownJobTypes() {
  return [...jobs.keys(), ...aliases.keys()];
}

export { registerJob, startJob, resolveJobType, getRegisteredJobTypes, getKnownJobTypes };
