"""Private binary stdin -> bounded JSON stdout; no network, macros or file writes."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.question_document_extract import DocumentError, MAX_FILE_BYTES, extract_document


def main():
    # POSIX workers also enforce a memory ceiling. Windows uses file/text/page
    # caps and the parent timeout; parsing never runs in the web process.
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    try:
        content = sys.stdin.buffer.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise DocumentError('DOCUMENT_TOO_LARGE', 'Tài liệu không được vượt quá 10 MB.')
        result = extract_document(content, sys.argv[1])
        payload = {'data': result}
    except DocumentError as exc:
        payload = {'error': {'code': exc.code, 'message': exc.message}}
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode('utf-8'))


if __name__ == '__main__':
    main()
