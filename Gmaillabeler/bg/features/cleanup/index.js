// bg/features/cleanup/index.js
// 받은편지함 정리 기능의 등록부.
//
// 잡(job)이 아니라 액션으로 등록한다. 미리보기는 읽기만 하고, 적용은 batchModify 한두 번이라
// 1초 안에 끝난다. 잡 러너에 태우면 그 시간 동안 다른 작업이 막히고, 진행률 0->100이
// 깜빡이는 것 말고는 얻는 게 없다.
//
// 다만 분류 작업이 도는 중에는 적용을 막는다. 그쪽도 같은 메일의 라벨을 건드리고 있어서,
// 겹치면 "분류가 방금 붙인 라벨을 정리가 떼는" 순서 문제가 생긴다.

import { registerAction } from "../../core/message_router.js";
import { isJobRunning } from "../../core/job_runner.js";
import { fetchLabelCache } from "../../platform/gmail_labels.js";
import { applyCleanup, getUndoInfo, previewCleanup, undoCleanup } from "./cleanup.js";

function register() {
  registerAction("cleanup.preview", async (request) => {
    try {
      return await previewCleanup(request.options || {});
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  registerAction("cleanup.apply", async (request) => {
    if (await isJobRunning()) {
      return { ok: false, error: "다른 작업이 실행 중입니다. 끝난 뒤에 정리하세요." };
    }
    try {
      // 처리 방식은 request.mode로 받는다. request.action은 라우터가 쓰는 액션 이름이라
      // ("cleanup.apply") 정리 방식(archive/trash/label)을 같은 키에 담을 수 없다.
      return await applyCleanup({
        ids: request.ids,
        action: request.mode,
        targetLabelId: request.targetLabelId,
      });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  registerAction("cleanup.undo", async () => {
    if (await isJobRunning()) {
      return { ok: false, error: "다른 작업이 실행 중입니다. 끝난 뒤에 되돌리세요." };
    }
    try {
      return await undoCleanup();
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  registerAction("cleanup.undoInfo", () => getUndoInfo());

  // '라벨만 지정' 모드에서 고를 수 있는 라벨 목록. 사용자가 만든 라벨만 준다 -
  // 시스템 라벨(INBOX, SPAM 등)을 정리 대상 라벨로 붙이는 것은 의미가 없다.
  registerAction("cleanup.listLabels", async () => {
    try {
      const cache = await fetchLabelCache();
      const labels = [...cache.exact.entries()]
        .filter(([name]) => !cache.systemNames.has(name))
        .map(([name, id]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, labels };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

export { register };
