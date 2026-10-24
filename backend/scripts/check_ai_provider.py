"""Safe local AI diagnostics. --probe makes real calls using the provider's quota.

Run with backend/.venv/Scripts/python.exe backend/scripts/check_ai_provider.py
from any directory. Model IDs are shown; keys, URLs and raw replies are never printed.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.services.ai_provider import AIProviderError, provider_diagnostics


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true', help='Call the real provider once per feature; consumes project quota.')
    args = parser.parse_args()
    diagnostics = provider_diagnostics()
    print(json.dumps(diagnostics, ensure_ascii=False, indent=2))
    if not args.probe:
        return 0 if diagnostics['configured'] else 2
    if not diagnostics['configured']:
        return 2
    from docx import Document
    from app.services.question_document_extract import extract_document, chunk_sections, DocumentError
    from app.services.question_generation import get_question_generation_provider
    from app.services.support_assistant_provider import get_support_provider
    from app.services import support_knowledge as kb
    failures = 0
    for feature in ('question', 'support'):
        try:
            if feature == 'question':
                document = Document()
                document.add_paragraph('HTML mô tả cấu trúc của trang web. CSS quy định cách trình bày, màu sắc và bố cục. JavaScript bổ sung hành vi tương tác cho trang web.')
                buffer = BytesIO(); document.save(buffer)
                extracted = extract_document(buffer.getvalue(), 'docx')
                source = chunk_sections(extracted['sections'])[0]
                drafts = get_question_generation_provider().generate(sources=[source], requirements={source['id']: 1},
                    config={'question_type': 'mcq_single', 'difficulty': 'easy', 'topic': 'Web'}, excluded=[])
                result = {'feature': feature, 'real_provider_call': True, 'validated_drafts': len(drafts), 'imported': False}
            else:
                query = 'Camera không hoạt động, làm sao cấp quyền camera trên trình duyệt?'
                sources = kb.retrieve('student', 'camera', query)
                selected = get_support_provider().answer(role='student', category='camera', query=query, sources=sources)
                result = {'feature': feature, 'real_provider_call': True, 'selected_articles': len(selected.article_ids), 'needs_admin': selected.needs_admin}
            print(json.dumps(result, ensure_ascii=False))
        except (AIProviderError, DocumentError) as error:
            failures += 1
            print(json.dumps({'feature': feature, 'error_code': error.code}, ensure_ascii=False))
        except Exception as error:
            failures += 1
            print(json.dumps({'feature': feature, 'error_code': 'INTERNAL_ERROR', 'error_type': type(error).__name__}, ensure_ascii=False))
    print(json.dumps({'connection_tested': True, 'all_features_passed': failures == 0}))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
