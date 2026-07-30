// crypto-helper.js
// 백업 파일/Drive에 저장하는 API 키·OAuth 시크릿을 평문 그대로 두지 않고, 사용자가 입력한
// 암호(비밀번호)로 AES-GCM 암호화해서 저장하기 위한 공용 헬퍼. background.js(importScripts)와
// popup.js(그냥 <script> 태그) 양쪽에서 그대로 쓸 수 있게 순수 함수로만 구성.
// 서버가 없는 순수 클라이언트 확장이라, "암호를 아는 사람만 복호화 가능"하게 만드는 게
// 현실적으로 취할 수 있는 가장 실질적인 보안 조치다 - 암호 자체는 어디에도 저장하지 않는다.

function cryptoBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function cryptoBase64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function cryptoDeriveKey(passphrase, saltBuf) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations: 150000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// plaintextObj(일반 JS 객체)를 암호로 암호화해서 {salt, iv, ciphertext}(전부 base64 문자열)로 반환
async function encryptWithPassphrase(passphrase, plaintextObj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cryptoDeriveKey(passphrase, salt);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(plaintextObj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    salt: cryptoBufferToBase64(salt),
    iv: cryptoBufferToBase64(iv),
    ciphertext: cryptoBufferToBase64(ciphertext),
  };
}

// {salt, iv, ciphertext}를 같은 암호로 복호화해서 원래 객체로 되돌림. 암호가 틀리면 예외를 던짐.
async function decryptWithPassphrase(passphrase, encBlob) {
  const salt = cryptoBase64ToBuffer(encBlob.salt);
  const iv = cryptoBase64ToBuffer(encBlob.iv);
  const key = await cryptoDeriveKey(passphrase, salt);
  const ciphertext = cryptoBase64ToBuffer(encBlob.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
