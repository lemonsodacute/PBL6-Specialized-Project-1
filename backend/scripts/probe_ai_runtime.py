"""Real, minimal provider probes. No documents, credentials or raw replies logged."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from app.core.config import get_settings
from app.services.ai_provider import OpenAICompatibleClient, model_for, response_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['plain', 'structured'], default='plain')
    args = parser.parse_args()
    settings = get_settings()
    url = OpenAICompatibleClient(settings).validate_config() + '/chat/completions'
    failed = False
    for feature in ('question', 'support'):
        body = {'model': model_for(feature, settings), 'messages': [{'role': 'user', 'content': 'Trả lời đúng một từ: OK'}]}
        if args.mode == 'structured':
            body['messages'][0]['content'] = 'Create one question about HTML with its correct answer using the provided JSON schema.'
            body['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'minimal_questions', 'strict': True, 'schema': {
                'type': 'object', 'properties': {'questions': {'type': 'array', 'items': {'type': 'object',
                    'properties': {'content': {'type': 'string'}, 'correct_answer': {'type': 'string'}},
                    'required': ['content', 'correct_answer'], 'additionalProperties': False}}},
                'required': ['questions'], 'additionalProperties': False}}}
        result = {'feature': feature, 'model': model_for(feature, settings), 'mode': args.mode}
        try:
            response = httpx.post(url, headers={'Authorization': 'Bearer ' + settings.QUESTION_GENERATION_API_KEY},
                                 json=body, timeout=45, follow_redirects=False)
            result.update(http_status=response.status_code, response_received=True)
            if not response.is_success:
                error = response_error(response)
                result.update(error_code=error.code, sanitized_error_message=error.message)
                failed = True
            else:
                content = response.json()['choices'][0]['message']['content']
                if args.mode == 'plain':
                    result['reply_is_ok'] = content.strip() == 'OK'
                    failed |= not result['reply_is_ok']
                else:
                    parsed = json.loads(content)
                    result['parse_success'] = bool(parsed['questions']) and all(isinstance(q['content'], str) and isinstance(q['correct_answer'], str) for q in parsed['questions'])
                    failed |= not result['parse_success']
        except httpx.HTTPError as exc:
            result.update(http_status=None, error_code='AI_PROVIDER_UNAVAILABLE', error_type=type(exc).__name__)
            failed = True
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            result.update(parse_success=False, error_code='AI_INVALID_RESPONSE', error_type=type(exc).__name__)
            failed = True
        print(json.dumps(result, ensure_ascii=True), flush=True)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
