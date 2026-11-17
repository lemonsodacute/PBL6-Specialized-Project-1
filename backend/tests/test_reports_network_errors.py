"""Regression: Windows-safe Vietnam report dates and CORS-visible unhandled API failures."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from unittest import TestCase

from starlette.requests import Request

from app.core.config import settings
from app.main import server_error
from app.services.report_collections import trend_from_timestamps


class ReportTimezoneTests(TestCase):
    def test_converts_utc_and_aware_timestamps_to_vietnam_day(self):
        stamps = [
            datetime(2026, 11, 16, 16, 59, tzinfo=timezone.utc),
            datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 16, 18, 0),  # PostgreSQL UTC-naive legacy timestamp.
            datetime(2026, 11, 17, 1, 0, tzinfo=timezone(timedelta(hours=7))),
        ]
        self.assertEqual(trend_from_timestamps(stamps), [
            {'date': '2026-11-16', 'value': 1},
            {'date': '2026-11-17', 'value': 3},
        ])


class ErrorCORSRegressionTests(TestCase):
    @staticmethod
    def request(origin):
        return Request({
            'type': 'http',
            'method': 'GET',
            'scheme': 'http',
            'path': '/api/v1/teacher/reports',
            'raw_path': b'/api/v1/teacher/reports',
            'query_string': b'page=1&limit=20',
            'headers': [(b'host', b'localhost:8000'), (b'origin', origin.encode())],
            'server': ('localhost', 8000),
        })

    def test_allowed_origin_receives_error_status_json_and_cors(self):
        if not settings.CORS_ORIGINS:
            self.skipTest('No configured CORS origins')
        origin = settings.CORS_ORIGINS[0]
        response = asyncio.run(server_error(self.request(origin), RuntimeError('test-only failure')))
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers.get('access-control-allow-origin'), origin)
        self.assertEqual(response.headers.get('access-control-allow-credentials'), 'true')
        self.assertEqual(response.headers.get('vary'), 'Origin')
        self.assertEqual(json.loads(response.body)['error']['code'], 'INTERNAL_ERROR')

    def test_disallowed_origin_is_not_reflected(self):
        response = asyncio.run(server_error(
            self.request('http://untrusted.invalid'), RuntimeError('test-only failure')))
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('access-control-allow-origin', response.headers)
        self.assertNotIn('access-control-allow-credentials', response.headers)
