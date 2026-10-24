"""Run one retention pass: python -m scripts.cleanup_student_card_previews."""
from app.services.student_card_retention import cleanup_once

if __name__ == '__main__':
    print({'removed_preview_directories': cleanup_once()})
