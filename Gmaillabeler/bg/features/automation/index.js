// bg/features/automation/index.js
// 자동 실행 기능의 등록부.
//
// 실제 작업은 startJob(jobType, payload)로만 시작한다. 그래서 이 기능은 분류나 요약 구현이
// 어디에 있는지 알지 못하고, background.js에서 이 기능의 import 한 줄을 지우면
// 자동 실행만 멈추고 수동 실행은 그대로 동작한다.

import { isKeepAliveAlarm } from "../../core/keep_alive.js";
import { migrateToLatestSettings } from "../../../settings/settings_migration.js";
import {
  AUTO_CLASSIFY_CHECK_ALARM,
  checkAutoClassifyTrigger,
  checkAutoSummaryTrigger,
  delayInitialAutoClassifyCheck,
  registerAutoClassifyAlarm,
} from "./automation.js";

function register() {
  // 알람은 서비스워커가 뜰 때마다 다시 걸어둔다. onInstalled/onStartup에만 의존하면
  // 워커가 비정상 종료된 뒤 알람이 사라진 채로 남을 수 있다. create는 멱등이라 중복돼도 무해하다.
  registerAutoClassifyAlarm();

  chrome.runtime.onStartup.addListener(async () => {
    try {
      await migrateToLatestSettings();
    } catch (e) {
      console.warn("[GmailLabeler] 설정 마이그레이션 실패:", e);
    }
    registerAutoClassifyAlarm();
    delayInitialAutoClassifyCheck();
    // 작업 중 아이콘 복원은 appearance 기능이 서비스워커가 뜰 때마다 알아서 한다.
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (isKeepAliveAlarm(alarm.name)) {
      // 서비스워커 활성 상태 유지 용도. 깨어난 것 자체가 목적이라 할 일이 없다.
      return;
    }
    if (alarm.name === AUTO_CLASSIFY_CHECK_ALARM) {
      // 자동 분류가 먼저 끝나야 새로 붙은 라벨이 자동 요약 대상에 잡힌다.
      // (분류 작업이 시작됐다면 checkAutoSummaryTrigger는 실행 중 확인에서 스스로 물러난다)
      checkAutoClassifyTrigger().then(() => checkAutoSummaryTrigger());
    }
  });
}

export { register };
