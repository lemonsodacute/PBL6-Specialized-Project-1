from typing import Any
def ok(data: Any, *, total: int | None = None, page: int | None = None, limit: int | None = None) -> dict:
    return {'data': data, 'meta': {'total': total, 'page': page, 'limit': limit}}

