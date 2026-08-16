// bg/core/keep_alive.js
// MV3 서비스워커는 30초쯤 유휴하면 종료된다. 긴 작업이나 OAuth 로그인 창이 떠 있는 동안
// 워커가 죽으면 진행 중이던 콜백이 통째로 사라지므로, 1분짜리 알람으로 깨어 있게 한다.

const KEEP_ALIVE_ALARM = "gmailLabelerKeepAlive";

function startKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEP_ALIVE_ALARM);
}

function isKeepAliveAlarm(alarmName) {
  return alarmName === KEEP_ALIVE_ALARM;
}

export { KEEP_ALIVE_ALARM, startKeepAlive, stopKeepAlive, isKeepAliveAlarm };
