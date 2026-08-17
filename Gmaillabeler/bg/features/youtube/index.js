// bg/features/youtube/index.js
// YouTube 기능의 등록부.

import { registerAction } from "../../core/message_router.js";
import { registerJob } from "../../core/job_registry.js";
import { analyzeYouTubeComments, analyzeYouTubeVideo } from "./youtube.js";

function register() {
  registerAction("analyzeYouTubeVideo", async (request) => {
    return await analyzeYouTubeVideo(request || {});
  });

  registerAction("analyzeYouTubeComments", async (request) => {
    return await analyzeYouTubeComments(request || {});
  });

  registerJob("youtube_summarize", {
    aliases: ["youtube.summary"],
    jobKind: "youtubeSummary",
    notifyTitleKey: "notifyTitleYoutubeSummary",
    resolve: (payload) => ({
      run: () => analyzeYouTubeVideo(payload || {})
    })
  });
}

export { register };
