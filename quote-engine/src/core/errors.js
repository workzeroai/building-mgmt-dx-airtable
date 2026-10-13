// 엔진 전체에서 쓰는 오류 종류. code는 화면·API 응답·알림에 그대로 노출된다.

export class QuoteEngineError extends Error {
  constructor(message, { code = 'ENGINE_ERROR', status = 500, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export class ValidationError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'VALIDATION_FAILED', status: 400, details });
  }
}

export class NotFoundError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'NOT_FOUND', status: 404, details });
  }
}

export class AddressNotFoundError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'ADDRESS_NOT_FOUND', status: 404, details });
  }
}

export class BuildingNotFoundError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'BUILDING_NOT_FOUND', status: 404, details });
  }
}

export class ExternalApiError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'EXTERNAL_API_FAILED', status: 502, details });
  }
}

/** 스테이징 대상에 매핑표에 없는 ID로 쓰기를 시도했을 때(운영 데이터 오염 방지). */
export class StagingGuardError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'STAGING_ID_GUARD', status: 409, details });
  }
}

export class TemplateError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'TEMPLATE_INVALID', status: 422, details });
  }
}

export class PdfTimeoutError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'PDF_TIMEOUT', status: 504, details });
  }
}

export class PdfConvertError extends QuoteEngineError {
  constructor(message, details) {
    super(message, { code: 'PDF_CONVERT_FAILED', status: 500, details });
  }
}
