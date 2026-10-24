from fastapi import Query


class CollectionParams:
    def __init__(self, q: str = Query('', max_length=255), page: int | None = Query(None, ge=1),
                 limit: int = Query(20, ge=1, le=100), sort: str = Query('newest', max_length=40)):
        self.q, self.page, self.limit, self.sort = q.strip(), page, limit, sort
