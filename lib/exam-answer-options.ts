/** Render both existing string choices and API choices with stable IDs. */
export function examOptions(value: unknown): { value: string; label: string }[] {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' && 'options' in value ? (value as { options: unknown }).options : [];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(option => {
    if (typeof option === 'string') return [{ value: option, label: option }];
    if (!option || typeof option !== 'object') return [];
    const id = option.id ?? option.value;
    const text = option.text ?? option.label;
    return typeof id === 'string' && typeof text === 'string' ? [{ value: id, label: text }] : [];
  });
}

export function examSelection(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const answer = value as Record<string, unknown>;
    value = answer.selected_option_id ?? answer.selected_option_ids ?? answer.selected_option ?? answer.selected_options ?? answer.answer ?? answer.answers
      ?? answer.correct_option_id ?? answer.correct_option_ids ?? answer.correct_option ?? answer.correct_options;
  }
  return (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value])
    .filter((item): item is string => typeof item === 'string');
}

export function examEssay(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const answer = value as Record<string, unknown>;
  const text = answer.text ?? answer.answer ?? answer.content;
  return typeof text === 'string' ? text : '';
}
