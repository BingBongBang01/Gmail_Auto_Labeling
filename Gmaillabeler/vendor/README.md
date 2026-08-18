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

## tesseract (스캔본 OCR용 · 선택)

스캔된 이미지 PDF를 번역하려면 필요하다. 넣지 않아도 확장은 정상 동작하고,
텍스트 레이어가 있는 PDF는 그대로 번역된다. 스캔본을 만나면
"OCR을 쓸 수 없습니다"를 로그에 남기고 나머지 쪽만 처리한다.

`tesseract.js`는 Apache-2.0이라 재배포 제약은 없지만, mupdf와 같은 이유로
(코어 wasm이 수 MB) 저장소에 넣지 않고 로컬에서 받아 쓴다.

### 폴더 모양

```
Gmaillabeler/vendor/tesseract/
  tesseract.min.js          <- tesseract.js dist
  worker.min.js             <- tesseract.js dist
  core/
    tesseract-core-simd-lstm.wasm.js    <- tesseract.js-core (필수)
    tesseract-core-simd-lstm.wasm
    tesseract-core-lstm.wasm.js         <- SIMD 미지원 환경 대비(선택)
    tesseract-core-lstm.wasm
  lang/
    eng.traineddata.gz
    kor.traineddata.gz      <- 읽을 언어만 골라 넣는다
```

`corePath`는 `core/` 디렉터리를 가리키고, tesseract.js가 SIMD 지원 여부를 보고
그 안에서 파일을 고른다. OEM은 LSTM 전용으로 고정하므로 `*-lstm.*` 파일만 있으면 된다.

### 받기 (tesseract.js 5.x)

```bash
mkdir -p Gmaillabeler/vendor/tesseract/core Gmaillabeler/vendor/tesseract/lang

npm pack tesseract.js@5.1.1 tesseract.js-core@5.1.1
tar -xzf tesseract.js-5.1.1.tgz && cp package/dist/tesseract.min.js package/dist/worker.min.js \
  Gmaillabeler/vendor/tesseract/
rm -rf package
tar -xzf tesseract.js-core-5.1.1.tgz && cp package/tesseract-core*lstm.wasm* \
  Gmaillabeler/vendor/tesseract/core/
rm -rf package
```

npm이 없으면 tarball을 직접 받아도 된다(주소만 다르고 나머지는 같다).

```bash
curl -sL https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz -o t.tgz
curl -sL https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz -o tc.tgz
```

### 언어 데이터

`langPath`가 `lang/`을 가리키고 tesseract.js가 `<언어>.traineddata.gz`를 찾는다.
**gzip 상태 그대로** 두어야 한다(압축을 풀면 로드에 실패한다).

```bash
cd Gmaillabeler/vendor/tesseract/lang
# 빠른 쪽(권장). 정확도를 더 원하면 4.0.0_fast -> 4.0.0 으로 바꾼다.
curl -sLO https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz
curl -sLO https://tessdata.projectnaptha.com/4.0.0_fast/kor.traineddata.gz
```

쓸 언어 코드: `eng` `kor` `jpn` `chi_sim` `chi_tra` `spa` `fra` `deu`.
사이드패널 세부 설정의 "OCR 언어"를 비워두면 원문 언어에서 골라 쓰고,
직접 적으면(`kor+eng`) 그 값이 이긴다. 적어 넣은 언어의 파일이 여기 없으면 OCR이 실패한다.

### 확인

`pdf/testdata/selftest.html`에서 "OCR 점검"을 누른다. 표본 PDF를 이미지로 렌더한 뒤
그 이미지에서 글자를 다시 읽어내므로, 통과하면 스캔본과 같은 경로가 도는 것이다.

### 왜 blob: 워커를 쓰지 않나

tesseract.js는 기본값(`workerBlobURL: true`)으로 워커 스크립트를 blob: URL로 감싸 띄운다.
확장의 CSP(`script-src 'self'`)가 blob: 워커를 막으므로 `false`로 두고
확장 안의 `worker.min.js`를 직접 가리킨다(`pdf/ocr/tesseract_ocr.js`).
