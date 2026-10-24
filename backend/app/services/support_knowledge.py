"""Only managed support articles are indexed; never exam/question-bank tables."""
from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata


@lru_cache
def knowledge():
    return json.loads((Path(__file__).resolve().parents[1] / 'support' / 'knowledge.json').read_text(encoding='utf-8'))


def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.lower().replace('đ', 'd')) if not unicodedata.combining(c))


def categories(role):
    return knowledge()['categories'].get(role, [])


def category_for(role, category):
    return next((item for item in categories(role) if item['id'] == category), None)


def articles(db=None):
    if db is None:  # Standalone evaluation of the bundled seed library.
        return knowledge()['articles']
    from sqlalchemy import select
    from app.models.entities import SupportArticle
    return [dict(id=a.id, title=a.title, role=a.role, category=a.category, steps=a.content.splitlines(),
        keywords=a.keywords, route=a.route, is_active=a.is_active, requires_admin=a.requires_admin)
        for a in db.scalars(select(SupportArticle)).all()]


def seed(db):
    from app.models.entities import SupportArticle
    for a in knowledge()['articles']:
        db.add(SupportArticle(id=a['id'], title=a['title'], role=a['role'], category=a['category'],
            content='\n'.join(a['steps']), keywords=a['keywords'], route=a['route'], is_active=a['is_active'], requires_admin=a['requires_admin']))
    db.flush()


def article_for(role, article_id, db=None):
    return next((a for a in articles(db) if a['role'] == role and a['id'] == article_id and a['is_active']), None)


def redact(value):
    from app.services.ai_privacy import redact_ai_text
    return redact_ai_text(value)


def is_greeting(query):
    return re.sub(r'[^a-z0-9 ]', '', normalize(query)).strip() in {'alo', 'hello', 'hi', 'xin chao', 'chao', 'chao ban'}


def infer_category(role, query):
    text = normalize(query).strip()
    # Only exact reviewed labels/aliases may switch context; never guess roles.
    for category in categories(role):
        if text in [normalize(category['label']), category['id'], *category.get('aliases', [])]:
            return category['id']
    return None


def retrieve(role, category, query, db=None, with_scores=False):
    text = normalize(query)
    stop = {'toi', 'em', 'minh', 'bi', 'khong', 'duoc', 'lam', 'sao', 'cua', 'va', 'co', 'cho', 'gi', 'voi', 'nay', 'the', 'da', 'can', 'ho', 'tro'}
    words = set(re.findall(r'[a-z0-9_]+', text)) - stop
    ranked = []
    for article in articles(db):
        if article['role'] != role or not article['is_active']:
            continue
        keywords = [normalize(k) for k in [article['title'], *article['keywords']]]
        phrase = any(len(k) >= 3 and re.search(r'(?<![a-z0-9])' + re.escape(k) + r'(?![a-z0-9])', text) for k in keywords)
        terms = set(re.findall(r'[a-z0-9_]+', ' '.join(keywords) + ' ' + normalize(' '.join(article['steps'])))) - stop
        overlap = len(words & terms)
        if not phrase and overlap < 2:
            continue
        # Category is a ranking hint. A stale selected category must not hide a
        # strong lexical match elsewhere in this user's role-scoped help library.
        ranked.append((10 * phrase + overlap + (article['category'] == category), article))
    result = sorted(ranked, key=lambda item: item[0], reverse=True)[:3]
    return [{'id': a['id'], 'score': score} for score, a in result] if with_scores else [a for _, a in result]


def public_source(article):
    return {key: article[key] for key in ('id', 'title', 'route', 'steps')}
