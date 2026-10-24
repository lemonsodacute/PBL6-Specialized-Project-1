import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
import httpx

from app.services.ai_provider import (AIProviderError, OpenAICompatibleClient, provider_configured, ai_trace, response_error,
                                      provider_status, provider_diagnostics, model_for)
from app.services.question_generation import generation_available


def configured(**updates):
    return SimpleNamespace(QUESTION_GENERATION_BASE_URL='https://provider.example/v1',
        QUESTION_GENERATION_API_KEY='secret-never-public', QUESTION_GENERATION_MODEL='question-model',
        SUPPORT_ASSISTANT_MODEL=updates.pop('SUPPORT_ASSISTANT_MODEL', 'support-model'),
        QUESTION_GENERATION_SUPPORTS_VISION=True, QUESTION_GENERATION_TIMEOUT=30, SUPPORT_AI_TIMEOUT=25,
        **updates)


def answer(content='{}'):
    return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': content}}]})


class SharedProviderTests(TestCase):
    def invoke(self, handler, *, feature='question', settings=None):
        client_class = httpx.Client
        with patch('app.services.ai_provider.httpx.Client', side_effect=lambda **kw: client_class(transport=httpx.MockTransport(handler), **kw)), patch('app.services.ai_provider.time.sleep'):
            return OpenAICompatibleClient(settings or configured()).complete(messages=[{'role': 'user', 'content': 'test'}],
                schema={'type': 'object', 'properties': {}, 'additionalProperties': False}, schema_name='test', timeout=10, feature=feature)

    def test_models_override_only_model_with_one_connection_and_fallback(self):
        calls = []
        def handle(request):
            calls.append(request)
            return answer()
        self.invoke(handle)
        self.invoke(handle, feature='support')
        self.invoke(handle, feature='support', settings=configured(SUPPORT_ASSISTANT_MODEL='  '))
        self.assertEqual([json.loads(call.content)['model'] for call in calls], ['question-model', 'support-model', 'question-model'])
        self.assertEqual(len({str(call.url) for call in calls}), 1)
        for call in calls:
            self.assertEqual(call.headers['authorization'], 'Bearer secret-never-public')
            self.assertNotIn('secret-never-public', call.content.decode())
            self.assertFalse(json.loads(call.content)['store'])

    def test_shared_configuration_handles_missing_placeholders_and_invalid_urls(self):
        settings = configured()
        for base, key, model, expected in [('', '', '', 'AI_NOT_CONFIGURED'),
                ('https://provider.example/v1', '<tôi sẽ tự điền>', '<model mạnh>', 'AI_NOT_CONFIGURED'),
                ('https://user:secret@provider.example/v1', 'key', 'model', 'AI_REQUEST_FAILED'),
                ('http://provider.example/v1', 'key', 'model', 'AI_REQUEST_FAILED'),
                ('https://provider.example/v1?key=secret', 'key', 'model', 'AI_REQUEST_FAILED'),
                ('https://provider.example/v1', 'key', 'model', None)]:
            settings.QUESTION_GENERATION_BASE_URL, settings.QUESTION_GENERATION_API_KEY, settings.QUESTION_GENERATION_MODEL = base, key, model
            self.assertEqual(provider_configured(settings), generation_available(settings))
            self.assertEqual((provider_status(settings)['error'] or {}).get('code'), expected)
        settings.SUPPORT_ASSISTANT_MODEL = ''
        self.assertEqual(model_for('support', settings), settings.QUESTION_GENERATION_MODEL)

    def test_http_errors_are_distinct_safe_and_only_transient_statuses_retry(self):
        for status, body, expected, count in [
            (401, {'code': 'invalid_api_key'}, 'AI_AUTH_FAILED', 1),
            (403, {'code': 'access_denied'}, 'AI_AUTH_FAILED', 1),
            (404, {'code': 'model_not_found'}, 'AI_MODEL_UNSUPPORTED', 1),
            (400, {'param': 'response_format'}, 'AI_MODEL_UNSUPPORTED', 1),
            (429, {'code': 'rate_limit_exceeded'}, 'AI_RATE_LIMITED', 2),
            (400, {'status': 'INVALID_ARGUMENT', 'details': [{'reason': 'API_KEY_INVALID'}]}, 'AI_AUTH_FAILED', 1),
            (429, {'status': 'RESOURCE_EXHAUSTED'}, 'AI_RATE_LIMITED', 2),
            (404, {'status': 'NOT_FOUND'}, 'AI_MODEL_UNSUPPORTED', 1),
            (503, {}, 'AI_PROVIDER_UNAVAILABLE', 2),
            (302, {}, 'AI_REQUEST_FAILED', 1),
        ]:
            calls = []
            def handle(request):
                calls.append(request)
                return httpx.Response(status, headers={'location': 'https://other.example'}, json={'error': {**body, 'message': 'secret-never-public'}})
            with self.assertRaises(AIProviderError) as error:
                self.invoke(handle)
            self.assertEqual(error.exception.code, expected)
            self.assertEqual(len(calls), count)
            self.assertNotIn('secret', str(error.exception))

    def test_transient_and_read_timeout_retries_are_bounded(self):
        calls = []
        def transient(request):
            calls.append(request)
            return httpx.Response(503) if len(calls) == 1 else answer()
        self.assertEqual(self.invoke(transient), '{}')
        self.assertEqual(len(calls), 2)
        calls.clear()
        def timeout(request):
            calls.append(request)
            raise httpx.ReadTimeout('secret-never-public', request=request)
        with self.assertRaises(AIProviderError) as error:
            self.invoke(timeout)
        self.assertEqual(error.exception.code, 'AI_PROVIDER_UNAVAILABLE')
        self.assertEqual(len(calls), 2)

    def test_slow_success_may_use_full_configured_request_budget(self):
        timeouts = []
        def handle(request):
            timeouts.append(request.extensions['timeout'])
            return answer()
        self.assertEqual(self.invoke(handle), '{}')
        self.assertEqual(len(timeouts), 1)
        self.assertGreater(timeouts[0]['read'], 9)
        self.assertLessEqual(timeouts[0]['read'], 10)
        self.assertLessEqual(timeouts[0]['connect'], 5)

    def test_malformed_output_and_long_retry_after_never_leak_or_retry_forever(self):
        for response in [answer('not JSON secret-never-public'), answer('x' * 1_000_001),
                         httpx.Response(200, json={'choices': []}), httpx.Response(429, headers={'retry-after': '999'})]:
            calls = []
            def handle(request):
                calls.append(request)
                return response
            with self.assertRaises(AIProviderError) as error:
                self.invoke(handle)
            self.assertNotIn('secret', str(error.exception))
            self.assertEqual(len(calls), 1)

    def test_diagnostics_show_models_but_never_key_or_url(self):
        output = provider_diagnostics(configured())
        self.assertTrue(output['configured'])
        self.assertTrue(output['vision_supported'])
        self.assertFalse(output['connection_tested'])
        self.assertEqual(output['question_model'], 'question-model')
        self.assertEqual(output['support_model'], 'support-model')
        for value in ['secret-never-public', 'https://provider.example/v1']:
            self.assertNotIn(value, json.dumps(output))
        settings = configured()
        settings.SUPPORT_ASSISTANT_MODEL = settings.QUESTION_GENERATION_API_KEY
        self.assertNotIn(settings.QUESTION_GENERATION_API_KEY, json.dumps(provider_diagnostics(settings)))

    def test_gemini_shared_endpoint_schema_models_and_diagnostics(self):
        settings = configured()
        settings.QUESTION_GENERATION_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
        settings.QUESTION_GENERATION_MODEL = 'gemini-3.8-flash'
        settings.SUPPORT_ASSISTANT_MODEL = 'gemini-3.5-flash-lite'
        calls = []
        def handle(request):
            calls.append(request)
            body = json.loads(request.content)
            self.assertNotIn('store', body)
            self.assertEqual(body['response_format']['type'], 'json_schema')
            self.assertTrue(body['response_format']['json_schema']['strict'])
            self.assertEqual(str(request.url), settings.QUESTION_GENERATION_BASE_URL + 'chat/completions')
            self.assertEqual(request.headers['authorization'], 'Bearer secret-never-public')
            return answer()
        self.invoke(handle, settings=settings)
        self.invoke(handle, settings=settings, feature='support')
        self.assertEqual([json.loads(r.content)['model'] for r in calls], ['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
        diag = provider_diagnostics(settings)
        self.assertEqual(diag['provider'], 'gemini-openai-compatible')
        self.assertEqual(diag['question_model'], settings.QUESTION_GENERATION_MODEL)
        self.assertEqual(diag['support_model'], settings.SUPPORT_ASSISTANT_MODEL)
        self.assertTrue(diag['vision_enabled'])

    def test_invalid_json_refusal_and_truncation_have_invalid_response_code(self):
        for result in [answer('not-json'), answer('x' * 1_000_001), httpx.Response(200, json={'choices': []}),
                httpx.Response(200, json={'choices': [{'finish_reason': 'length', 'message': {'content': '{}'}}]}),
                httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': '{}', 'refusal': 'blocked'}}]})]:
            with self.subTest(response=result), self.assertRaises(AIProviderError) as error:
                self.invoke(lambda request: result)
            self.assertEqual(error.exception.code, 'AI_INVALID_RESPONSE')

    def test_restart_from_different_working_directories_loads_same_backend_env(self):
        backend = Path(__file__).resolve().parents[1]
        script = backend / 'scripts' / 'check_ai_provider.py'
        results = [subprocess.run([sys.executable, str(script)], cwd=directory, capture_output=True, text=True, encoding='utf-8', timeout=20) for directory in (backend, backend.parent)]
        for result in results:
            self.assertIn(result.returncode, (0, 2))
        self.assertEqual(json.loads(results[0].stdout), json.loads(results[1].stdout))

    def test_google_array_error_envelope_is_normalized(self):
        for status, body, expected in [(400, {'status': 'INVALID_ARGUMENT', 'details': [{'reason': 'API_KEY_INVALID'}]}, 'AI_AUTH_FAILED'),
                (404, {'status': 'NOT_FOUND'}, 'AI_MODEL_UNSUPPORTED'),
                (429, {'status': 'RESOURCE_EXHAUSTED'}, 'AI_RATE_LIMITED'), (503, {'status': 'UNAVAILABLE'}, 'AI_PROVIDER_UNAVAILABLE')]:
            self.assertEqual(response_error(httpx.Response(status, json=[{'error': body}])).code, expected)

    def test_dev_trace_omits_payloads_credentials_and_raw_errors_and_disables_in_production(self):
        settings = configured(); settings.ENVIRONMENT = 'development'
        with self.assertLogs('uvicorn.error', level='INFO') as logs:
            ai_trace('provider_error', settings=settings, error_code='AI_AUTH_FAILED', http_status=401,
                     document='private-document', message='secret-never-public', api_key='secret-never-public')
        output = ''.join(logs.output)
        self.assertIn('401', output)
        self.assertIn('sanitized_error_message', output)
        self.assertNotIn('private-document', output)
        self.assertNotIn('secret-never-public', output)
        settings.ENVIRONMENT = 'production'
        with patch('app.services.ai_provider.logging.getLogger') as logger:
            ai_trace('provider_error', settings=settings, http_status=401)
            logger.assert_not_called()

    def test_dev_last_provider_status_tracks_errors_and_recovery_without_payloads(self):
        settings = configured(); settings.ENVIRONMENT = 'development'
        ai_trace('provider_error', settings=settings, http_status=503, error_code='AI_PROVIDER_UNAVAILABLE')
        failed = provider_diagnostics(settings)['last_calls']['question']
        self.assertEqual(failed['http_status'], 503)
        self.assertEqual(failed['error_code'], 'AI_PROVIDER_UNAVAILABLE')
        ai_trace('provider_response', settings=settings, http_status=200)
        ai_trace('provider_json', settings=settings, http_status=200, parse_success=True)
        recovered = provider_diagnostics(settings)['last_calls']['question']
        self.assertEqual(recovered['http_status'], 200)
        self.assertIsNone(recovered['error_code'])
        self.assertNotIn('secret-never-public', json.dumps(recovered))

    def test_oversized_response_updates_safe_diagnostics(self):
        settings = configured(ENVIRONMENT='development')
        self.invoke(lambda request: answer(), settings=settings)
        with self.assertRaises(AIProviderError):
            self.invoke(lambda request: answer('x' * 1_000_001), settings=settings)
        result = provider_diagnostics(settings)['last_calls']['question']
        self.assertEqual(result['http_status'], 200)
        self.assertEqual(result['error_code'], 'AI_INVALID_RESPONSE')


class AIDiagnosticsAccessTests(TestCase):
    def test_feature_apis_agree_on_missing_valid_and_malformed_configuration(self):
        from tests import test_support_chat as fixtures
        fixture = fixtures.SupportChatTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        settings = configured()
        for base, key, expected, code in [('https://provider.example/v1', '', False, 'AI_NOT_CONFIGURED'),
                ('https://provider.example/v1', 'secret-never-public', True, None),
                ('http://external.example/v1', 'secret-never-public', False, 'AI_REQUEST_FAILED')]:
            settings.QUESTION_GENERATION_BASE_URL = base
            settings.QUESTION_GENERATION_API_KEY = key
            with patch('app.services.ai_provider.get_settings', return_value=settings):
                questions = fixture.client.get(f'/api/v1/question-banks/{fixture.bank.id}/document-capabilities', headers=fixture.headers()).json()['data']
                response = fixture.client.post('/api/v1/support-assistant/sessions', headers=fixture.headers(), json={})
                self.assertEqual(response.status_code, 200)
                support = response.json()['data']
                self.assertEqual(questions['generation_available'], expected)
                self.assertEqual(support['provider_configured'], expected)
                self.assertEqual((questions['provider_status']['error'] or {}).get('code'), code)
                self.assertEqual((support['provider_error'] or {}).get('code'), code)
                self.assertNotIn('secret-never-public', json.dumps([questions, support]))

    def test_diagnostics_are_admin_only_and_disabled_in_production(self):
        from tests import test_teacher_results as fixtures
        fixture = fixtures.TeacherResultsTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        path = '/api/v1/admin/ai-provider/diagnostics'
        settings = configured(); settings.ENVIRONMENT = 'development'
        with patch('app.api.v1.ai_provider.get_settings', return_value=settings):
            response = fixture.client.get(path, headers=fixture.headers(fixture.admin))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['data']['configured'])
            self.assertNotIn('secret-never-public', response.text)
            self.assertEqual(fixture.client.get(path, headers=fixture.headers(fixture.student)).status_code, 403)
            self.assertEqual(fixture.client.get(path).status_code, 401)
            settings.ENVIRONMENT = 'production'
            self.assertEqual(fixture.client.get(path, headers=fixture.headers(fixture.admin)).status_code, 404)
