"""Private attachments retained with imported questions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0013_question_images'
down_revision = '0012_live_classroom'
branch_labels = None
depends_on = None


def upgrade():
    if 'images_json' not in {column['name'] for column in sa.inspect(op.get_bind()).get_columns('questions')}:
        op.add_column('questions', sa.Column('images_json', postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column('questions', 'images_json')
