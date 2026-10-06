import type { VoucherApi } from '../shared/types/api';

declare global {
  interface Window {
    /** The only bridge between the renderer and the main process. */
    voucherApi: VoucherApi;
  }
}

export {};
