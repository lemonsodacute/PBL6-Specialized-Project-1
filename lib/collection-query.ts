export type ListParams = Record<string, string | number | boolean | undefined>;
export const listQuery = (params: ListParams = {}) => new URLSearchParams(Object.entries(params).filter(([,value]) => value !== undefined && value !== '').map(([key,value]) => [key,String(value).trim()])).toString();
export type CollectionResponse<T> = { data: T[]; meta?: { total?: number; page?: number; limit?: number; topics?: string[];has_difficulty?:boolean } };
export function readCollection<T>(value: unknown): CollectionResponse<T> {
  const result=value as CollectionResponse<T>;
  if (!result || !Array.isArray(result.data)) throw new Error('Invalid collection response');
  return result;
}
