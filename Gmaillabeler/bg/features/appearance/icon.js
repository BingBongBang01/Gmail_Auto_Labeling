// bg/features/appearance/icon.js
// ---------------- 투명 배경 고시인성 왕 편지봉투 + AI Sparkle 아이콘 드로잉 ----------------
// 툴바 아이콘을 PNG 파일이 아니라 코드로 그린다. 작업 중에는 별도의 활성 아이콘으로 바꾼다.

function drawIconCodeData(size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size); // 배경 투명 처리!

  // 1. 대형 이메일 편지봉투 드로잉 (전체 캔버스 영역 85% 대형 렌더링)
  const envW = size * 0.84;
  const envH = size * 0.56;
  const envX = (size - envW) / 2;
  const envY = size * 0.32;

  // 봉투 테두리 및 그림자 (다크 네이비 테두리로 시인성 극대화)
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(envX - size * 0.03, envY - size * 0.03, envW + size * 0.06, envH + size * 0.06, size * 0.05);
  ctx.fill();

  // 봉투 본체 (화이트)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(envX, envY, envW, envH, size * 0.04);
  ctx.fill();

  // Gmail 시그니처 Red V-Shape Flap
  ctx.strokeStyle = "#ea4335";
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(envX, envY);
  ctx.lineTo(envX + envW / 2, envY + envH * 0.65);
  ctx.lineTo(envX + envW, envY);
  ctx.stroke();

  // 2. 우측 상단 대형 AI Glowing Sparkle Badge (cx: 0.74, cy: 0.26, r: 0.25)
  const sparkX = size * 0.74;
  const sparkY = size * 0.26;
  const sparkR = size * 0.25;

  // AI 뱃지 테두리
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, sparkR + size * 0.03, 0, Math.PI * 2);
  ctx.fill();

  // AI 뱃지 바디 (Vivid Cyan -> Violet)
  const sparkGrad = ctx.createLinearGradient(sparkX - sparkR, sparkY - sparkR, sparkX + sparkR, sparkY + sparkR);
  sparkGrad.addColorStop(0, "#06b6d4");
  sparkGrad.addColorStop(1, "#7c3aed");

  ctx.fillStyle = sparkGrad;
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, sparkR, 0, Math.PI * 2);
  ctx.fill();

  // ✦ AI 별빛 (화이트)
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(size * 0.3)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✦", sparkX, sparkY);

  return ctx.getImageData(0, 0, size, size);
}

function updateDynamicIconFromCode() {
  try {
    const imageData = {
      16: drawIconCodeData(16),
      32: drawIconCodeData(32),
      48: drawIconCodeData(48),
      128: drawIconCodeData(128),
    };
    chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn("코드 기반 동적 아이콘 드로잉 예외:", e);
  }
}

function setActionIconRunning(isRunning) {
  try {
    if (isRunning) {
      chrome.action.setIcon({ path: "icon128-active.png" });
    } else {
      // 평상시 아이콘은 setIcon({path})로 덮어쓰면 시작 시 코드로 그린 동적 아이콘이 사라지므로,
      // 항상 같은 드로잉 코드로 다시 렌더링해서 되돌린다.
      updateDynamicIconFromCode();
    }
  } catch (e) {
    // 아이콘 전환 실패는 치명적이지 않으므로 무시
  }
}

export { drawIconCodeData, updateDynamicIconFromCode, setActionIconRunning };
