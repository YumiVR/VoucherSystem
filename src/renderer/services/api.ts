import type { IpcChannel, IpcContract } from '@shared/types/api';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Calls the main process and unwraps the result, throwing an operator-safe ApiError on failure. */
export async function call<C extends IpcChannel>(channel: C, request: IpcContract[C]['req']): Promise<IpcContract[C]['res']> {
  const result = await window.voucherApi.invoke(channel, request);
  if (!result.ok) throw new ApiError(result.code, result.message);
  return result.data;
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}
