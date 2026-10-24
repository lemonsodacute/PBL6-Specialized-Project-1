"""Minimize obvious credentials and personal identifiers in outbound AI text.

This is a text safeguard, not a classifier for uploaded pictures. Only course
document images may enter the question-generation pipeline; support is text only.
"""
import re


def redact_ai_text(value):
    value = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?(?:-----END [^-]*PRIVATE KEY-----|$)', '[đã ẩn private key]', value, flags=re.S)
    value = re.sub(r'(?i)(?:bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[đã ẩn token]', value)
    value = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})', '[đã ẩn API key]', value)
    value = re.sub(r'(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://\S+', '[đã ẩn kết nối dữ liệu]', value)
    value = re.sub(r'(?i)\b(mssv|mã sinh viên|student[_ -]?id)\s*(?:[:=]|là)?\s*([A-Z0-9_-]*\d[A-Z0-9_-]*)\b', r'\1: [đã ẩn]', value)
    value = re.sub(r'(?i)(password|mật khẩu|api[_ -]?key|secret|(?:access[_ -]?|refresh[_ -]?)?token|mssv|mã sinh viên|student[_ -]?id)\s*(?:[:=]|là)\s*\S+', r'\1: [đã ẩn]', value)
    value = re.sub(r'(?i)\bbearer\s+[A-Za-z0-9._~-]+', '[đã ẩn token]', value)
    return re.sub(r'(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[đã ẩn email]', value)


def sanitize_ai_data(value):
    if isinstance(value, str):
        return redact_ai_text(value)
    if isinstance(value, list):
        return [sanitize_ai_data(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_ai_data(item) for key, item in value.items()}
    return value
