// pdf/ocr/image_utils.js
// 렌더한 페이지 이미지에서 픽셀을 읽는 유틸. chrome.* 도 mupdf 도 쓰지 않는다.
//
// 왜 필요한가: 스캔본의 원문은 텍스트 레이어가 아니라 이미지 픽셀이다. redaction으로는
// 지울 수 없어서(지울 텍스트가 애초에 없다) 번역문을 그냥 그리면 원문 글자 위에 겹쳐 찍힌다.
// 그래서 글자 상자를 배경색으로 덮고 그 위에 그린다. 흰색으로 고정하면 누런 스캔본이나
// 색 배경 위에서 흰 사각형이 도드라지므로, 상자 주변 픽셀에서 실제 배경색을 뽑아 쓴다.

// 상자 바깥 테두리에서 표본을 뽑는다. 상자 안쪽은 글자라서 배경색이 아니다.
const SAMPLE_TARGET = 320; // 이보다 많이 뽑아도 중앙값은 달라지지 않는다

async function decodeImageData(blob) {
  // OffscreenCanvas는 오프스크린 문서/워커 양쪽에 다 있다. 없으면 배경색 추정을 포기한다
  // (흰색으로 물러나며, 번역 자체는 그대로 진행된다).
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (e) {
    return null;
  } finally {
    // 비트맵은 GC를 기다리지 않고 즉시 놓는다. 300DPI A4 한 장이 30MB쯤 된다.
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return 255;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 글자 상자(픽셀 좌표) 주변의 배경색을 추정한다.
 * 평균이 아니라 중앙값을 쓴다 - 테두리에 옆 글자나 표 선이 걸려도 끌려가지 않는다.
 */
function sampleBackgroundColor(imageData, box, pad = 3) {
  if (!imageData) return "#ffffff";

  const { width, height, data } = imageData;
  const x0 = clamp(Math.floor(box.x0) - pad, 0, width - 1);
  const y0 = clamp(Math.floor(box.y0) - pad, 0, height - 1);
  const x1 = clamp(Math.ceil(box.x1) + pad, 0, width - 1);
  const y1 = clamp(Math.ceil(box.y1) + pad, 0, height - 1);
  if (x1 <= x0 || y1 <= y0) return "#ffffff";

  const perimeter = 2 * (x1 - x0 + y1 - y0);
  const step = Math.max(1, Math.floor(perimeter / SAMPLE_TARGET));
  const reds = [];
  const greens = [];
  const blues = [];

  const take = (x, y) => {
    const i = (y * width + x) * 4;
    reds.push(data[i]);
    greens.push(data[i + 1]);
    blues.push(data[i + 2]);
  };

  for (let x = x0; x <= x1; x += step) {
    take(x, y0);
    take(x, y1);
  }
  for (let y = y0; y <= y1; y += step) {
    take(x0, y);
    take(x1, y);
  }

  return toHex(median(reds), median(greens), median(blues));
}

// 배경이 어두우면 검은 글자는 읽을 수 없다. 밝기로 갈라 흰 글자로 뒤집는다.
// 계수는 sRGB 상대 휘도 근사(ITU-R BT.601)다.
function pickReadableTextColor(bgHex) {
  const hex = String(bgHex || "").replace("#", "");
  if (hex.length !== 6) return "#000000";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 128 ? "#ffffff" : "#000000";
}

export { decodeImageData, sampleBackgroundColor, pickReadableTextColor, median, toHex };
