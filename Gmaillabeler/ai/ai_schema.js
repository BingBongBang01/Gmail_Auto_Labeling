// ai/ai_schema.js
// 이 저장소의 호출부는 모두 Gemini 방언 스키마를 넘긴다(타입 이름이 대문자: "OBJECT"/"ARRAY"/"STRING").
// Gemini는 그 형태를 그대로 받지만, OpenAI의 strict json_schema와 Anthropic의 tool input_schema는
// 표준 JSON Schema(소문자 타입)를 요구하고 둘 다 루트가 반드시 object여야 한다.
// 호출부를 전부 고치는 대신 여기서 변환과 래핑을 담당한다.

const AI_SCHEMA_WRAPPER_KEY = "result";

const AI_SCHEMA_TYPE_MAP = {
  OBJECT: "object",
  ARRAY: "array",
  STRING: "string",
  INTEGER: "integer",
  NUMBER: "number",
  BOOLEAN: "boolean",
};

// Gemini 전용 키워드. 표준 JSON Schema에는 없어서 그대로 보내면 검증 오류가 난다.
const AI_SCHEMA_GEMINI_ONLY_KEYS = new Set(["nullable", "format", "example", "propertyOrdering"]);

class AISchema {
  // Gemini 방언 -> 표준 JSON Schema.
  // strict:true면 OpenAI strict 모드의 추가 요구사항(additionalProperties:false,
  // 그리고 모든 속성을 required에 나열)까지 함께 적용한다.
  static toJsonSchema(schema, options = {}) {
    return this._convert(schema, options.strict === true);
  }

  static _convert(node, strict) {
    if (Array.isArray(node)) return node.map((child) => this._convert(child, strict));
    if (!node || typeof node !== "object") return node;

    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (AI_SCHEMA_GEMINI_ONLY_KEYS.has(key)) continue;

      if (key === "type" && typeof value === "string") {
        out.type = AI_SCHEMA_TYPE_MAP[value.toUpperCase()] || value.toLowerCase();
      } else if (key === "properties" && value && typeof value === "object") {
        out.properties = {};
        for (const [propName, propSchema] of Object.entries(value)) {
          out.properties[propName] = this._convert(propSchema, strict);
        }
      } else {
        out[key] = this._convert(value, strict);
      }
    }

    if (strict && out.type === "object" && out.properties) {
      out.additionalProperties = false;
      // strict 모드는 모든 속성이 required여야 한다. 원본에서 일부만 required였더라도
      // 이 저장소의 스키마는 전부 실제로 필요한 필드라서 의미가 달라지지 않는다.
      out.required = Object.keys(out.properties);
    }
    return out;
  }

  // OpenAI json_schema와 Anthropic input_schema는 루트가 object여야 한다.
  // 루트가 배열이면(분류 결과 목록 등이 그렇다) 단일 속성 객체로 감싸고,
  // 응답을 받은 뒤 unwrapRoot()로 다시 벗겨낸다.
  static wrapRoot(jsonSchema) {
    if (jsonSchema && jsonSchema.type === "object") {
      return { schema: jsonSchema, wrapped: false };
    }
    return {
      wrapped: true,
      schema: {
        type: "object",
        properties: { [AI_SCHEMA_WRAPPER_KEY]: jsonSchema },
        required: [AI_SCHEMA_WRAPPER_KEY],
        additionalProperties: false,
      },
    };
  }

  static unwrapRoot(value, wrapped) {
    if (!wrapped) return value;
    if (value && typeof value === "object" && AI_SCHEMA_WRAPPER_KEY in value) {
      return value[AI_SCHEMA_WRAPPER_KEY];
    }
    return value;
  }
}

// 서비스워커(importScripts)와 확장 페이지(<script>) 양쪽에서 같은 이름으로 접근할 수 있게 한다.
// window로 내보내면 서비스워커에서는 아무것도 등록되지 않는다.
globalThis.AISchema = AISchema;
