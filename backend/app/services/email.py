from abc import ABC, abstractmethod
import logging

from app.core.config import settings

logger = logging.getLogger('app.email')
logger.setLevel(logging.INFO)

class EmailSender(ABC):
    @abstractmethod
    def send(self, to: str, subject: str, body: str) -> None:
        raise NotImplementedError

class ConsoleEmailSender(EmailSender):
    def send(self, to: str, subject: str, body: str) -> None:
        logger.info('Email delivery is not configured; message not sent (recipient and content withheld).')

def get_email_sender() -> EmailSender:
    if settings.EMAIL_PROVIDER.strip().lower() == 'console':
        return ConsoleEmailSender()
    raise ValueError(f'Unsupported EMAIL_PROVIDER: {settings.EMAIL_PROVIDER}')
