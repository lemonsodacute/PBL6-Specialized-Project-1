"""Shared server-only provider transport. Feature services own their prompts/context.

The existing QUESTION_GENERATION_* variables configure the shared connection and
base model. SUPPORT_ASSISTANT_MODEL is a model-only override. Never log raw
provider errors, credentials, prompts or model output.
"""
import json
import logging
import math
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import Lock
from urllib.parse import urlsplit
import httpx
from app.core.config import get_settings

AI_MESSAGES = {
    'AI_NOT_CONFIGURED': 'Dịch vụ AI chưa được cấu hình trên máy chủ.',
    'AI_AUTH_FAILED': 'Không thể xác thực dịch vụ AI. Quản trị viên cần kiểm tra API key và quyền truy cập.',
    'AI_RATE_LIMITED': 'Đã đạt giới hạn AI tạm thời. Vui lòng thử lại sau.',
    'AI_INVALID_RESPONSE': 'AI trả dữ liệu không đúng định dạng. Vui lòng thử lại.',
    'AI_PARSE_ERROR': 'Chưa đọc được kết quả từ AI. Vui lòng thử lại phần lỗi.',
    'AI_TIMEOUT': 'AI phản hồi quá lâu. Vui lòng thử lại phần lỗi.',
    'AI_PROVIDER_UNAVAILABLE': 'Dịch vụ AI đang tạm thời không khả dụng.',
    'AI_REQUEST_FAILED': 'Yêu cầu AI thất bại. Quản trị viên cần kiểm tra API key, quyền truy cập và cấu hình kết nối.',
    'AI_MODEL_UNSUPPORTED': 'Model AI không tồn tại, chưa được cấp quyền hoặc không hỗ trợ tính năng yêu cầu. Quản trị viên cần kiểm tra model.',
}

AI_ERROR_CATEGORIES = {
    'AI_NOT_CONFIGURED': 'configuration', 'AI_AUTH_FAILED': 'authentication',
    'AI_RATE_LIMITED': 'rate_limit', 'AI_TIMEOUT': 'timeout',
    'AI_PROVIDER_UNAVAILABLE': 'provider_unavailable', 'AI_INVALID_RESPONSE': 'invalid_response',
    'AI_PARSE_ERROR': 'parsing', 'AI_MODEL_UNSUPPORTED': 'model', 'AI_REQUEST_FAILED': 'request',
}


def retry_after_seconds(value):
    """Honor both Retry-After formats without logging the provider's raw header."""
    if not value:
        return 0.3
    try:
        delay = float(value)
    except (ValueError, TypeError):
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            delay = date.timestamp() - time.time()
        except (ValueError, TypeError, OverflowError):
            return 0.3
    return max(0.3, delay) if math.isfinite(delay) else float('inf')


def extract_response_json(content):
    """Accept a complete JSON value, optionally wrapped in one JSON code fence.

    Never extract arbitrary braces from prose or repair truncated output.
    Feature-specific schema and source validation still run after this step.
    """
    value = content.strip().lstrip('\ufeff')
    fenced = re.fullmatch(r'```(?:json)?\s*\n(.*?)\n?```', value, re.DOTALL | re.IGNORECASE)
    if fenced:
        value = fenced.group(1).strip()
    json.loads(value)
    return value

_runtime_lock = Lock()
_runtime_status = {}


class AIProviderError(Exception):
    def __init__(self, code='AI_REQUEST_FAILED', *, capability=None):
        self.code = code if code in AI_MESSAGES else 'AI_REQUEST_FAILED'
        self.capability = capability
        self.message = AI_MESSAGES[self.code]
        super().__init__(self.message)


class AIProviderNotConfigured(AIProviderError):
    def __init__(self):
        super().__init__('AI_NOT_CONFIGURED')


def config_value(settings, name):
    return str(getattr(settings, name, '') or '').strip()


def is_configured_value(value):
    return bool(value and not (value.startswith('<') and value.endswith('>')))


def model_for(feature='question', settings=None):
    settings = settings or get_settings()
    default = config_value(settings, 'QUESTION_GENERATION_MODEL')
    return (config_value(settings, 'SUPPORT_ASSISTANT_MODEL') or default) if feature == 'support' else default


def configuration_error(settings=None):
    settings = settings or get_settings()
    values = [config_value(settings, key) for key in ('QUESTION_GENERATION_BASE_URL', 'QUESTION_GENERATION_API_KEY', 'QUESTION_GENERATION_MODEL')]
    if not all(is_configured_value(value) for value in values):
        return 'AI_NOT_CONFIGURED'
    try:
        url = urlsplit(values[0])
        if (url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password
                or url.query or url.fragment or any(c.isspace() for c in values[0])
                or (url.scheme == 'http' and url.hostname not in {'localhost', '127.0.0.1', '::1'})):
            return 'AI_REQUEST_FAILED'
        _ = url.port
    except ValueError:
        return 'AI_REQUEST_FAILED'
    return None


def provider_configured(settings=None):
    return configuration_error(settings) is None


def provider_status(settings=None):
    settings = settings or get_settings()
    code = configuration_error(settings)
    return {'configured': code is None, 'error': {'code': code, 'message': AI_MESSAGES[code]} if code else None}


def provider_capabilities(feature='question', settings=None):
    settings = settings or get_settings()
    return {'supports_text': True, 'supports_vision': feature == 'question' and bool(getattr(settings, 'QUESTION_GENERATION_SUPPORTS_VISION', False))}


def provider_name(settings):
    try:
        if urlsplit(config_value(settings, 'QUESTION_GENERATION_BASE_URL')).hostname == 'generativelanguage.googleapis.com':
            return 'gemini-openai-compatible'
    except ValueError:
        pass
    return 'openai_compatible'


def diagnostic_model(feature, settings):
    model = model_for(feature, settings)
    key = config_value(settings, 'QUESTION_GENERATION_API_KEY')
    if not is_configured_value(model):
        return 'missing'
    if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}', model)
            or (key and key in model) or model.startswith(('sk-', 'AIza'))):
        return 'configured'
    return model


def provider_diagnostics(settings=None):
    settings = settings or get_settings()
    return {'provider': provider_name(settings), **provider_status(settings),
            'default_model': 'configured' if is_configured_value(model_for(settings=settings)) else 'missing',
            'question_model': diagnostic_model('question', settings),
            'support_model': diagnostic_model('support', settings),
            'support_model_overridden': bool(config_value(settings, 'SUPPORT_ASSISTANT_MODEL')),
            'supports_text': True, 'vision_supported': provider_capabilities(settings=settings)['supports_vision'],
            'vision_enabled': provider_capabilities(settings=settings)['supports_vision'],
            'connection_tested': False, 'runtime_scope': 'current_process',
            'last_calls': runtime_status(settings)}


def runtime_status(settings):
    with _runtime_lock:
        return {feature: dict(_runtime_status.get((provider_name(settings), model_for(feature, settings), feature), {}))
                for feature in ('question', 'support')}


def response_error(response):
    # Normalize both OpenAI and Google's error envelopes. Never expose raw text.
    try:
        body = response.json()
        # Gemini sometimes wraps even non-streaming HTTP errors in a list.
        if isinstance(body, list):
            body = body[0] if body else {}
        error = body.get('error', {}) if isinstance(body, dict) else {}
        code = error.get('code') if isinstance(error, dict) else None
        param = error.get('param') if isinstance(error, dict) else None
        status = error.get('status') if isinstance(error, dict) else None
        details = error.get('details', []) if isinstance(error, dict) else []
        reasons = [item.get('reason') for item in details if isinstance(item, dict)] if isinstance(details, list) else []
        message = str(error.get('message', '')).lower() if isinstance(error, dict) else ''
    except ValueError:
        code, param, status, reasons, message = None, None, None, [], ''
    if response.status_code == 429 or status == 'RESOURCE_EXHAUSTED' or code in ('rate_limit_exceeded', 'insufficient_quota'):
        return AIProviderError('AI_RATE_LIMITED')
    if (response.status_code in (401, 403) or status in ('UNAUTHENTICATED', 'PERMISSION_DENIED')
            or code in ('invalid_api_key', 'authentication_error') or any(reason in reasons for reason in
                ('API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED'))):
        return AIProviderError('AI_AUTH_FAILED')
    if response.status_code in (400, 422) and (param == 'image_url' or code in ('invalid_image', 'unsupported_image', 'image_parse_error')
            or (status == 'INVALID_ARGUMENT' and any(phrase in message for phrase in
                ('image input is not supported', 'image input modality is not enabled', 'unable to process input image', 'invalid image', 'unsupported image')))):
        return AIProviderError('AI_MODEL_UNSUPPORTED', capability='vision')
    if response.status_code == 404 and status == 'NOT_FOUND':
        return AIProviderError('AI_MODEL_UNSUPPORTED')
    if code in ('model_not_found', 'unsupported_model', 'model_not_supported') or (response.status_code in (400, 404, 422) and param in ('model', 'response_format', 'image_url')):
        return AIProviderError('AI_MODEL_UNSUPPORTED')
    if response.status_code in (408, 504):
        return AIProviderError('AI_TIMEOUT')
    if response.status_code >= 500:
        return AIProviderError('AI_PROVIDER_UNAVAILABLE')
    return AIProviderError('AI_REQUEST_FAILED')


def ai_trace(event, *, feature='question', settings=None, **fields):
    """DEV-only diagnostics with an allowlist: never record payloads or exceptions.

Messages are local normalized descriptions, not provider text (which may echo
documents, credentials or URLs even after regex redaction).
    """
    from app.services.ai_metrics import observe
    observe(event, fields)
    settings = settings or get_settings()
    if getattr(settings, 'ENVIRONMENT', '') not in ('development', 'dev', 'local', 'test'):
        return
    if event in ('provider_response', 'provider_error', 'provider_json', 'question_parse', 'support_parse'):
        with _runtime_lock:
            key = (provider_name(settings), model_for(feature, settings), feature)
            state = _runtime_status.setdefault(key, {})
            state['checked_at'] = datetime.now(timezone.utc).isoformat()
            if 'http_status' in fields:
                state['http_status'] = fields['http_status']
            if fields.get('error_code') in AI_MESSAGES:
                state['error_code'] = fields['error_code']
            elif fields.get('parse_success'):
                state['error_code'] = None
    allowed = {'http_status', 'error_type', 'error_code', 'chunk_index', 'chunk_count', 'input_chars',
               'provider_called', 'response_received', 'parse_success', 'draft_count', 'attempt',
               'support_retrieval_count', 'selected_count', 'category', 'role', 'persist_success',
               'stage', 'latency_ms', 'retry_after_seconds'}
    data = {key: value for key, value in fields.items() if key in allowed}
    code = data.get('error_code')
    if code in AI_MESSAGES:
        data['sanitized_error_message'] = AI_MESSAGES[code]
        data['error_category'] = AI_ERROR_CATEGORIES[code]
    data.update(event=event, provider=provider_name(settings), model=diagnostic_model(feature, settings), feature=feature)
    logging.getLogger('uvicorn.error').info('ai_trace %s', json.dumps(data, ensure_ascii=False))


class OpenAICompatibleClient:
    def __init__(self, settings=None):
        self.settings = settings or get_settings()

    def validate_config(self):
        code = configuration_error(self.settings)
        if code == 'AI_NOT_CONFIGURED':
            raise AIProviderNotConfigured()
        if code:
            raise AIProviderError(code)
        return config_value(self.settings, 'QUESTION_GENERATION_BASE_URL').rstrip('/')

    def complete(self, *, messages, schema, schema_name, timeout, feature='question', max_response_bytes=1_000_000):
        url = self.validate_config()
        model = model_for(feature, self.settings)
        if not is_configured_value(model):
            raise AIProviderError('AI_MODEL_UNSUPPORTED')
        payload = {'model': model, 'messages': messages, 'store': False,
            'response_format': {'type': 'json_schema', 'json_schema': {
                'name': schema_name, 'strict': True, 'schema': schema}}}
        if provider_name(self.settings) == 'gemini-openai-compatible':
            # Google's compatibility API supports json_schema and image_url;
            # OpenAI's completion storage flag is not part of that contract.
            payload.pop('store')
        deadline = time.monotonic() + timeout
        # Both features share retry policy. At most one retry; never follow redirects.
        # No retry for auth, unsupported model, or rejected/malformed output.
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            for attempt in range(2):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    ai_trace('provider_error', settings=self.settings, feature=feature,
                             error_code='AI_TIMEOUT', error_type='DeadlineExceeded', stage='provider_transport')
                    raise AIProviderError('AI_TIMEOUT')
                started = time.monotonic()
                try:
                    ai_trace('provider_request', settings=self.settings, feature=feature, provider_called=True, attempt=attempt + 1)
                    response = client.post(url + '/chat/completions', headers={
                        'Authorization': 'Bearer ' + config_value(self.settings, 'QUESTION_GENERATION_API_KEY')},
                        # Let a slow successful generation use its configured
                        # budget. Reserving half for a retry cancelled healthy
                        # Gemini responses at 45s despite a 90s timeout. Fast
                        # transient failures may still retry within the deadline.
                        json=payload, timeout=httpx.Timeout(remaining, connect=min(5, remaining)))
                except (httpx.ConnectError, httpx.TimeoutException) as exc:
                    code = 'AI_TIMEOUT' if isinstance(exc, httpx.TimeoutException) else 'AI_PROVIDER_UNAVAILABLE'
                    ai_trace('provider_error', settings=self.settings, feature=feature, response_received=False,
                             http_status=None, error_code=code, error_type=type(exc).__name__,
                             stage='provider_transport', latency_ms=round((time.monotonic() - started) * 1000, 2))
                    if attempt == 0 and deadline - time.monotonic() > 1:
                        time.sleep(0.3 * 2 ** attempt)
                        continue
                    raise AIProviderError(code) from None
                except httpx.HTTPError as exc:
                    ai_trace('provider_error', settings=self.settings, feature=feature, response_received=False,
                             http_status=None, error_code='AI_PROVIDER_UNAVAILABLE', error_type=type(exc).__name__, stage='provider_transport')
                    raise AIProviderError('AI_PROVIDER_UNAVAILABLE') from None
                except (ValueError, TypeError) as exc:
                    ai_trace('provider_error', settings=self.settings, feature=feature, response_received=False,
                             error_code='AI_REQUEST_FAILED', error_type=type(exc).__name__)
                    raise AIProviderError('AI_REQUEST_FAILED') from None
                ai_trace('provider_response', settings=self.settings, feature=feature,
                         http_status=response.status_code, response_received=True, stage='provider_http',
                         latency_ms=round((time.monotonic() - started) * 1000, 2))
                if len(response.content) > max_response_bytes:
                    ai_trace('provider_error', settings=self.settings, feature=feature, http_status=response.status_code,
                             error_code='AI_INVALID_RESPONSE', error_type='ResponseSizeLimit')
                    raise AIProviderError('AI_INVALID_RESPONSE')
                if not response.is_success:
                    error = response_error(response)
                    delay = retry_after_seconds(response.headers.get('retry-after'))
                    ai_trace('provider_error', settings=self.settings, feature=feature, http_status=response.status_code,
                             error_code=error.code, error_type='HTTPError', stage='provider_http',
                             retry_after_seconds=round(delay, 2) if math.isfinite(delay) else None)
                    if attempt == 0 and response.status_code in (408, 429, 500, 502, 503, 504):
                        if delay <= 2 and deadline - time.monotonic() > delay + 1:
                            time.sleep(delay)
                            continue
                    raise error from None
                try:
                    choice = response.json()['choices'][0]
                    message = choice['message']
                    content = message['content']
                    if (choice.get('finish_reason') != 'stop' or message.get('refusal') or message.get('tool_calls')
                            or not isinstance(content, str) or not content.strip()):
                        raise ValueError()
                except json.JSONDecodeError:
                    ai_trace('provider_json', settings=self.settings, feature=feature, http_status=response.status_code,
                             parse_success=False, error_code='AI_PARSE_ERROR', error_type='JSONDecodeError', stage='response_envelope_json')
                    raise AIProviderError('AI_PARSE_ERROR') from None
                except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                    ai_trace('provider_json', settings=self.settings, feature=feature, http_status=response.status_code,
                             parse_success=False, error_code='AI_INVALID_RESPONSE', error_type='ResponseEnvelopeError', stage='response_envelope')
                    raise AIProviderError('AI_INVALID_RESPONSE') from None
                try:
                    content = extract_response_json(content)
                except (ValueError, TypeError):
                    ai_trace('provider_json', settings=self.settings, feature=feature, http_status=response.status_code,
                             parse_success=False, error_code='AI_PARSE_ERROR', error_type='JSONDecodeError', stage='response_json')
                    raise AIProviderError('AI_PARSE_ERROR') from None
                ai_trace('provider_json', settings=self.settings, feature=feature, http_status=response.status_code,
                         parse_success=True, stage='response_json')
                return content
        raise AIProviderError('AI_PROVIDER_UNAVAILABLE')
