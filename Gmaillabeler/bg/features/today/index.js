// bg/features/today/index.js
// '오늘' 브리핑의 등록부.
//
// 잡이 아니라 액션이다. 모으기는 읽기만 하고, 브리핑은 AI 요청 한 번이다.
// 잡 러너에 태우면 그동안 다른 작업이 막히는데 얻을 게 없다.

import { registerAction } from "../../core/message_router.js";
import { buildBrief, collectToday } from "./today.js";

function register() {
  registerAction("today.collect", async () => {
    try {
      return await collectToday();
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // 브리핑은 화면이 이미 모아둔 것을 넘겨받아 요약한다. 여기서 다시 수집하지 않는 이유:
  // 화면에 보이는 목록과 브리핑이 다른 데이터를 말하면 사용자는 어느 쪽을 믿을지 알 수 없다.
  registerAction("today.brief", async (request) => {
    try {
      return await buildBrief(request.data || {});
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

export { register };
