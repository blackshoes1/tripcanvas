'use client';
import { useSyncExternalStore } from 'react';

import {
  getPriceStoreServerSnapshot, getPriceStoreSnapshot, subscribePriceStore
} from '../services/localPriceStore';

export function usePriceStore() {
  const prices = useSyncExternalStore(subscribePriceStore, getPriceStoreSnapshot, getPriceStoreServerSnapshot);
  return { prices };
}
