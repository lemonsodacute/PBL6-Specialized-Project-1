from unittest import TestCase
from unittest.mock import patch
from pathlib import Path
import os
from pydantic import ValidationError
from app.core.config import Settings


class ReleaseConfigurationTests(TestCase):
    def test_clean_setup_can_load_the_environment_template(self):
        with patch.dict(os.environ, {}, clear=True):
            config = Settings(_env_file=Path(__file__).resolve().parents[1] / '.env.example')
        self.assertEqual(config.CORS_ORIGINS, ['http://localhost:3000'])
        self.assertEqual(config.ENVIRONMENT, 'development')

    def test_production_rejects_the_public_template_secret(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValidationError):
            Settings(_env_file=Path(__file__).resolve().parents[1] / '.env.example',
                     ENVIRONMENT='production', COOKIE_SECURE=None)

    def test_production_refuses_weak_jwt_secret_and_redacts_validation_input(self):
        sentinel = 'private-short-key'
        with self.assertRaises(ValidationError) as raised:
            Settings(_env_file=None, ENVIRONMENT='production', JWT_SECRET=sentinel)
        self.assertNotIn(sentinel, str(raised.exception))
        self.assertNotIn('JWT_SECRET=', repr(Settings(_env_file=None, JWT_SECRET=sentinel)))

    def test_production_accepts_distinct_long_secret_and_uses_secure_cookie(self):
        config = Settings(_env_file=None, ENVIRONMENT='production', JWT_SECRET='qa-only-long-configuration-secret-0123456789', COOKIE_SECURE=None)
        self.assertTrue(config.secure_cookies)

    def test_production_rejects_insecure_cookie_override(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, ENVIRONMENT='production', JWT_SECRET='qa-only-long-configuration-secret-0123456789', COOKIE_SECURE=False)

    def test_production_rejects_wildcard_cors(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, ENVIRONMENT='production', JWT_SECRET='qa-only-long-configuration-secret-0123456789', COOKIE_SECURE=None, CORS_ORIGINS=['*'])
