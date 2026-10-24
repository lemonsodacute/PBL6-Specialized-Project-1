"""Read-only collection queries; retain each endpoint's authorization predicates."""
import sqlite3
import unicodedata
from fastapi import HTTPException
from sqlalchemy import String, event, func, or_
from sqlalchemy.engine import Engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement


def fold_text(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').casefold()) if not unicodedata.combining(c)).replace('\u0111', 'd').strip()


ACCENTS = ''.join(chr(code) for code in range(0x00c0, 0x2000)
                  if len(fold_text(chr(code))) == 1 and fold_text(chr(code)) in 'abcdefghijklmnopqrstuvwxyz'
                  and chr(code) != fold_text(chr(code)))
PLAIN = ''.join(fold_text(char) for char in ACCENTS)


class Fold(FunctionElement):
    type = String()
    inherit_cache = True


@compiles(Fold, 'postgresql')
def pg_fold(element, compiler, **kw):
    return compiler.process(func.translate(func.lower(func.coalesce(list(element.clauses)[0], '')), ACCENTS, PLAIN), **kw)


@compiles(Fold)
def portable_fold(element, compiler, **kw):
    return 'fold_text(' + compiler.process(list(element.clauses)[0], **kw) + ')'


@event.listens_for(Engine, 'connect')
def sqlite_search(connection, _):
    if isinstance(connection, sqlite3.Connection):
        connection.create_function('fold_text', 1, fold_text, deterministic=True)


def search(query, q, *columns):
    value = fold_text(q)
    if value:
        pattern = '%' + value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(or_(*(Fold(column).like(pattern, escape='\\') for column in columns)))
    return query


def ordered(query, sort, choices, tie):
    if sort not in choices:
        raise HTTPException(422, detail={'code': 'INVALID_SORT', 'message': 'Unsupported sort', 'details': None})
    terms=choices[sort] if isinstance(choices[sort],(tuple,list)) else (choices[sort],)
    return query.order_by(None).order_by(*terms, tie)


def page_query(db, query, page, limit):
    total = db.scalar(func.count().select().select_from(query.order_by(None).subquery())) or 0
    if page is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    return query, total
