// bg/features/youtube/youtube.js
// YouTube 동영상 정보(제목, URL, 설명, 주제 등)를 기반으로 AI 요약 및 분석을 수행하는 모듈.

import { addLog } from "../../core/logger.js";
import { callAiForJson, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { i18nCurrentLocale } from "../../../i18n.js";
import { LANGUAGE_NAME_BY_LOCALE } from "../../domain/prompt_language.js";

async function analyzeYouTubeVideo({ videoTitle = "", videoUrl = "", promptType = "summary3", customPrompt = "" }) {
  const hasKey = await hasUsableAiCredential();
  if (!hasKey) {
    throw new Error("사용 가능한 AI API 키가 없습니다. 설정 > AI 모델 설정에서 API 키를 등록해 주세요.");
  }

  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
  const title = (videoTitle || "").trim() || "유튜브 동영상";
  const url = (videoUrl || "").trim();

  let instruction = "";
  if (promptType === "summary3") {
    instruction = `이 유튜브 동영상의 핵심 내용을 3가지 핵심 요약 포인트로 정리하고, 전반적인 개요와 주요 시청 대상/추천 이유를 ${langName}로 작성해라.`;
  } else if (promptType === "timeline") {
    instruction = `이 유튜브 동영상의 제목과 성격을 기반으로 예상되는 주요 흐름, 주요 핵심 토픽 및 단계별 논점(타임라인 구조)을 ${langName}로 일목요연하게 정리해라.`;
  } else if (promptType === "keywords") {
    instruction = `이 유튜브 동영상과 관련된 핵심 키워드, 검색 태그 5~10개, 주요 주제 및 카테고리 분류를 ${langName}로 추출해라.`;
  } else if (promptType === "qa") {
    instruction = customPrompt
      ? `다음 사용자 질문에 대해 이 유튜브 동영상의 맥락을 고려하여 ${langName}로 상세하고 명쾌하게 답변해라: "${customPrompt}"`
      : `이 동영상을 시청한 후 시청자가 가질 수 있는 핵심 질문 3가지와 그에 대한 간결한 답변을 ${langName}로 작성해라.`;
  } else {
    instruction = customPrompt || `이 유튜브 동영상에 대한 핵심 분석을 ${langName}로 제공해라.`;
  }

  const prompt =
    `[유튜브 동영상 정보]\n` +
    `- 제목: ${title}\n` +
    (url ? `- URL: ${url}\n` : "") +
    `\n[요청 사항]\n${instruction}\n\n` +
    `모든 응답은 ${langName}로 작성하며, 읽기 쉽고 명확하게 구조화해라.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          overview: { type: "STRING" },
          keyPoints: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          tags: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          takeaways: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["overview", "keyPoints", "tags"]
      }
    }
  };

  await addLog(`[YouTube AI] '${title.slice(0, 30)}...' 동영상 AI 분석을 시작합니다.`);
  const parsed = await callAiForJson(requestBody);
  await addLog(`[YouTube AI] '${title.slice(0, 30)}...' 동영상 분석이 완료되었습니다.`);

  return {
    ok: true,
    videoTitle: title,
    videoUrl: url,
    overview: parsed.overview || "",
    keyPoints: parsed.keyPoints || [],
    tags: parsed.tags || [],
    takeaways: parsed.takeaways || []
  };
}

async function analyzeYouTubeComments({ videoTitle = "", videoUrl = "", comments = [], customPrompt = "" }) {
  const hasKey = await hasUsableAiCredential();
  if (!hasKey) {
    throw new Error("사용 가능한 AI API 키가 없습니다. 설정 > AI 모델 설정에서 API 키를 등록해 주세요.");
  }

  if (!comments || comments.length === 0) {
    throw new Error("분석할 댓글이 없습니다. 댓글을 먼저 수집해 주세요.");
  }

  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
  const title = (videoTitle || "").trim() || "유튜브 동영상";

  // 최대 50개 댓글 표본 추출 (좋아요 많은 순 또는 대표 표본)
  const sampleComments = comments.slice(0, 50).map((c, i) => {
    const likes = c.likeCount && c.likeCount !== "0" ? ` (👍 ${c.likeCount})` : "";
    return `[${i + 1}] ${c.author}${likes}: ${c.text.replace(/\n+/g, " ").slice(0, 200)}`;
  }).join("\n");

  const prompt =
    `[유튜브 동영상 정보]\n` +
    `- 제목: ${title}\n` +
    (videoUrl ? `- URL: ${videoUrl}\n` : "") +
    `- 수집된 댓글 수: ${comments.length}개 (아래 ${Math.min(comments.length, 50)}개 표본)\n\n` +
    `[댓글 표본]\n` +
    sampleComments +
    `\n\n[요청 사항]\n` +
    (customPrompt ? `${customPrompt}\n` : "") +
    `위 시청자 댓글들을 종합적으로 분석하여 시청자들의 전반적인 반응, 여론 분위기, 가장 공감받은 핵심 의견, 주요 피드백 및 자주 언급된 키워드를 ${langName}로 명쾌하게 정리해라.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          sentimentOverview: { type: "STRING" },
          sentimentScore: { type: "STRING" },
          keyReactions: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          topFeedback: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          hotKeywords: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["sentimentOverview", "sentimentScore", "keyReactions", "hotKeywords"]
      }
    }
  };

  await addLog(`[YouTube 댓글 AI] '${title.slice(0, 30)}...' 영상의 댓글 ${comments.length}건 AI 여론 분석을 시작합니다.`);
  const parsed = await callAiForJson(requestBody);
  await addLog(`[YouTube 댓글 AI] '${title.slice(0, 30)}...' 영상 댓글 분석이 완료되었습니다.`);

  return {
    ok: true,
    videoTitle: title,
    totalComments: comments.length,
    sentimentOverview: parsed.sentimentOverview || "",
    sentimentScore: parsed.sentimentScore || "중립적",
    keyReactions: parsed.keyReactions || [],
    topFeedback: parsed.topFeedback || [],
    hotKeywords: parsed.hotKeywords || []
  };
}

export {
  analyzeYouTubeVideo,
  analyzeYouTubeComments
};
