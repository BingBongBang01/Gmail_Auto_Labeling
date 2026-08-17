# vendor/ — 서드파티 런타임

이 폴더의 내용물은 저장소에 커밋하지 않는다(`.gitignore` 참고).
확장을 처음 받은 PC에서는 아래대로 한 번 채워 넣어야 PDF 기능이 동작한다.

## 왜 커밋하지 않나

MuPDF는 **AGPL-3.0-or-later**다. 이 저장소는 공개(public)이고
`Gmaillabeler/LICENSE`는 재배포를 금지한다. AGPL은 결합 저작물을 배포하면
전체를 AGPL로 공개할 것을 요구하므로 두 조건이 함께 성립할 수 없다.
그래서 코드만 공개하고, AGPL 바이너리는 각자 로컬에서 받아 쓴다.

부수적으로 `mupdf-wasm.wasm` 하나가 10.4MB라 git 히스토리에 넣기에도 부담이다.

## mupdf (필수)

`mupdf@1.28.0`의 `dist/`에서 아래 3개를 `Gmaillabeler/vendor/mupdf/`에 넣는다.

| 파일 | 크기 |
|---|---|
| `mupdf.js` | 103 KB |
| `mupdf-wasm.js` | 29 KB |
| `mupdf-wasm.wasm` | 10.4 MB |

`.br`(brotli) 파일과 `.d.ts`는 필요 없다. 라이선스 고지를 위해 `LICENSE`도 함께 둔다.

### node/npm이 있는 경우

```bash
npm pack mupdf@1.28.0
tar -xzf mupdf-1.28.0.tgz
cp package/dist/mupdf.js package/dist/mupdf-wasm.js package/dist/mupdf-wasm.wasm package/LICENSE Gmaillabeler/vendor/mupdf/
```

### npm이 없는 경우

레지스트리에서 tarball만 직접 받아도 된다.

```bash
curl -sL https://registry.npmjs.org/mupdf/-/mupdf-1.28.0.tgz -o mupdf.tgz
tar -xzf mupdf.tgz
cp package/dist/mupdf.js package/dist/mupdf-wasm.js package/dist/mupdf-wasm.wasm package/LICENSE Gmaillabeler/vendor/mupdf/
```

### 확인

확장을 새로 고친 뒤 `chrome-extension://<확장ID>/pdf/testdata/selftest.html`을 열고
"점검 실행"을 누른다. 추출·원문 삭제·한글 삽입·저장이 한 바퀴 돌면 정상이다.

## 주의

`mupdf.js`는 `import.meta.url` 기준으로 `mupdf-wasm.wasm`을 찾는다.
세 파일은 반드시 같은 폴더에 나란히 두어야 한다.

`mupdf-wasm.wasm`에는 CJK 폰트(DroidSansFallback)가 내장되어 있다.
별도 폰트 파일을 받을 필요는 없다.

## tesseract (아직 미사용)

OCR 단계에서 추가 예정. 지금은 필요 없다.
