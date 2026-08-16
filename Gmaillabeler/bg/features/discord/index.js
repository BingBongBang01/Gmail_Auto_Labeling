// bg/features/discord/index.js
// Discord 기능의 등록부.
//
// 요약 기능은 이 파일도 discord.js도 import 하지 않는다.
// summary.completed 이벤트 구독 하나로만 연결되므로, background.js에서
// 이 기능의 import 한 줄을 지우면 Discord 전송만 사라지고 요약은 그대로 동작한다.

import { on } from "../../core/events.js";
import { SUMMARY_COMPLETED } from "../../core/topics.js";
import { registerAction } from "../../core/message_router.js";
import { addLog } from "../../core/logger.js";
import { SettingsStore } from "../../../settings/settings_store.js";
import { loadDiscordWebhookConfig, sendSummaryToDiscord } from "./discord.js";

function register() {
  registerAction("sendDiscordNotification", async (request) => {
    await sendSummaryToDiscord(request.webhookUrl, request.summaryReport);
    return { ok: true };
  });

  // 자동 요약 결과를 Discord로 흘려보내는 구독. 요약 기능은 이 구독이 있는지조차 모른다.
  on(SUMMARY_COMPLETED, async ({ summaryReport, source }) => {
    if (source !== "auto") return; // 수동 요약은 대시보드가 직접 전송을 요청한다
    if (!summaryReport || !summaryReport.selectedCount) return;

    const settings = await SettingsStore.getSettings();
    if (settings.automation?.autoSummary?.sendToDiscord === false) return;

    try {
      await sendSummaryToDiscord(await loadDiscordWebhookConfig(), summaryReport);
      await addLog(`[자동 요약] Discord 전송 완료 (${summaryReport.selectedCount}건).`);
    } catch (e) {
      // 요약 자체는 성공했으므로 전송 실패로 작업을 실패 처리하지는 않는다.
      // (emit()도 구독자 예외를 삼키지만, 여기서 잡아야 사용자에게 이유를 남길 수 있다)
      await addLog(`[자동 요약] Discord 전송 실패: ${e.message || e}`, "warn");
    }
  });
}

export { register };
